declare const process: { env: Record<string, string | undefined> }

const N8N_WEBHOOK_TIMEOUT_MS = 15_000
const N8N_ERROR_DETAIL_MAX_CHARS = 240

function currentVietnamTimestamp(now = new Date()) {
  return new Date(now.getTime() + 7 * 60 * 60 * 1_000).toISOString().replace('Z', '+07:00')
}

async function n8nWebhookError(webhookResponse: Response, webhookToken: string) {
  let detail = ''
  try {
    const responseText = (await webhookResponse.text()).slice(0, 8_192).trim()
    if (responseText.startsWith('{')) {
      const payload = JSON.parse(responseText)
      const candidate = payload?.message ?? payload?.error ?? payload?.description
      detail = typeof candidate === 'string'
        ? candidate
        : typeof candidate?.message === 'string' ? candidate.message : ''
    }
  } catch {
    detail = ''
  }
  if (detail && webhookToken) detail = detail.split(webhookToken).join('[đã ẩn]')
  detail = detail.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, N8N_ERROR_DETAIL_MAX_CHARS)

  if (webhookResponse.status === 403) {
    return 'Webhook n8n từ chối xác thực (HTTP 403). Đặt Header Auth Name là x-gustino-token, Value trùng N8N_SHIFT_PHOTO_WEBHOOK_TOKEN.'
  }
  const base = webhookResponse.status === 500
    ? 'Workflow n8n ảnh cuối ca lỗi HTTP 500.'
    : `Webhook n8n ảnh cuối ca trả lỗi HTTP ${webhookResponse.status}.`
  return detail ? `${base} Chi tiết: ${detail}` : base
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })

  const operator = await authenticatedOperator(request.headers?.authorization)
  if (!operator) return response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ để gửi ảnh cuối ca.' })
  if (!['shift_leader', 'admin'].includes(operator.role) || operator.active === false) {
    return response.status(403).json({ error: 'Chỉ ca trưởng hoặc Admin được gửi ảnh bàn giao.' })
  }

  const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  if (!input || !input.shiftId || !input.branchId || !input.businessDate) {
    return response.status(400).json({ error: 'Thiếu mã ca, chi nhánh hoặc ngày.' })
  }
  if (!['opening', 'closing'].includes(input.kind)) {
    return response.status(400).json({ error: 'Loại ảnh không hợp lệ.' })
  }
  if (typeof input.photoUrl !== 'string' || !/^https?:\/\//i.test(input.photoUrl)) {
    return response.status(400).json({ error: 'Ảnh phải có URL công khai (chưa upload xong lên storage).' })
  }

  const ownsSession = await verifySessionOwnership(operator, input)
  if (!ownsSession.ok) return response.status(ownsSession.status).json({ error: ownsSession.error })

  if (String(process.env.N8N_SHIFT_PHOTO_ENABLED || '').toLowerCase() !== 'true') {
    return response.status(200).json({ mode: 'disabled', sent: false, message: 'n8n ảnh cuối ca đang tắt (N8N_SHIFT_PHOTO_ENABLED).' })
  }
  const webhookUrl = process.env.N8N_SHIFT_PHOTO_WEBHOOK_URL
  const webhookToken = process.env.N8N_SHIFT_PHOTO_WEBHOOK_TOKEN
  if (!webhookUrl || !webhookToken) {
    return response.status(503).json({ code: 'N8N_NOT_CONFIGURED', error: 'Chưa cấu hình N8N_SHIFT_PHOTO_WEBHOOK_URL / TOKEN trên server.' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), N8N_WEBHOOK_TIMEOUT_MS)
  let webhookResponse: Response
  try {
    webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gustino-token': webhookToken },
      signal: controller.signal,
      body: JSON.stringify({
        job_key: `${input.shiftId}:${input.kind}:${Date.now()}`,
        branch_id: input.branchId,
        branch_name: input.branchName || input.branchId,
        business_date: input.businessDate,
        shift_id: input.shiftId,
        shift_sequence: input.shiftSequence ?? null,
        kind: input.kind,
        photo_url: input.photoUrl,
        leader_name: input.leaderName || operator.name || '',
        sent_at: currentVietnamTimestamp(),
      }),
    })
  } catch (error) {
    return response.status(502).json({
      code: 'N8N_WEBHOOK_FAILED',
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Webhook n8n ảnh cuối ca quá thời gian phản hồi.'
        : 'Không kết nối được webhook n8n ảnh cuối ca.',
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!webhookResponse.ok) {
    return response.status(502).json({ code: 'N8N_WEBHOOK_FAILED', error: await n8nWebhookError(webhookResponse, webhookToken) })
  }
  return response.status(200).json({ mode: 'n8n', sent: true })
}

async function authenticatedOperator(authorization: string | undefined) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '')
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!token || !url || !anonKey) return null
  const authResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } })
  if (!authResponse.ok) return null
  const authUser = await authResponse.json()
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,role,active,name`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!profileResponse.ok) return null
  const profiles = await profileResponse.json()
  return profiles?.[0] ? { ...profiles[0], accessToken: token, supabaseUrl: url, anonKey } : null
}

async function verifySessionOwnership(operator: any, input: any) {
  const headers = { apikey: operator.anonKey, Authorization: `Bearer ${operator.accessToken}`, Accept: 'application/json' }
  const params = new URLSearchParams({
    id: `eq.${input.shiftId}`,
    branch_id: `eq.${input.branchId}`,
    business_date: `eq.${input.businessDate}`,
    select: 'id,leader_id',
  })
  const sessionResponse = await fetch(`${operator.supabaseUrl}/rest/v1/bag_shift_sessions?${params}`, { headers })
  if (!sessionResponse.ok) return { ok: false, status: 502, error: 'Không kiểm tra được ca trên Supabase.' }
  const rows = await sessionResponse.json()
  const session = rows?.[0]
  if (!session) return { ok: false, status: 404, error: 'Không tìm thấy ca bàn giao tương ứng.' }
  if (operator.role !== 'admin' && session.leader_id !== operator.id) {
    return { ok: false, status: 403, error: 'Chỉ chính ca trưởng của ca này được gửi ảnh.' }
  }
  return { ok: true }
}
