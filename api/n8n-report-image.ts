declare const process: { env: Record<string, string | undefined> }

type ReportKind = 'shift-1' | 'shift-2' | 'day'

const REPORT_SEND_TIMES: Record<ReportKind, string> = {
  'shift-1': '15:15',
  'shift-2': '22:00',
  day: '22:15',
}
const MAX_BASE64_CHARS = 3_200_000
const N8N_WEBHOOK_TIMEOUT_MS = 20_000
const N8N_ERROR_DETAIL_MAX_CHARS = 240

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
    return 'Webhook n8n từ chối xác thực (HTTP 403). Đặt Header Auth Name là x-gustino-token, Value trùng N8N_REPORT_WEBHOOK_TOKEN; kiểm tra IP Whitelist rồi Publish workflow.'
  }
  const base = webhookResponse.status === 500
    ? 'Workflow n8n lỗi HTTP 500.'
    : `Webhook n8n trả lỗi HTTP ${webhookResponse.status}.`
  return detail
    ? `${base} Chi tiết n8n: ${detail} Mở n8n > Executions để xem node lỗi.`
    : `${base} Mở n8n > Executions để xem node lỗi.`
}

function n8nImmediateOnlyAck(responseText: string, payload: any) {
  const message = typeof payload?.message === 'string' ? payload.message : responseText
  return /workflow\s+(?:got|was|has been)\s+started/i.test(message)
}

async function n8nCompletedIngestion(webhookResponse: Response, expectedJobKey: string) {
  const responseText = (await webhookResponse.text()).slice(0, 8_192).trim()
  if (!responseText) {
    return {
      ok: false,
      code: 'N8N_EMPTY_ACK',
      error: 'n8n trả HTTP 200 nhưng response rỗng, chưa xác nhận đã ghi Sheet. Đặt Respond = When Last Node Finishes và để node Sheet trả JSON có job_key, row_number.',
    }
  }

  let payload: any
  try {
    payload = JSON.parse(responseText)
  } catch {
    return {
      ok: false,
      code: 'N8N_INVALID_ACK',
      error: 'n8n trả HTTP 200 nhưng response không phải JSON, chưa xác nhận đã ghi Sheet. Node cuối phải trả job_key và row_number.',
    }
  }

  if (n8nImmediateOnlyAck(responseText, payload)) {
    return {
      ok: false,
      code: 'N8N_EARLY_ACK',
      error: 'n8n mới chỉ xác nhận bắt đầu workflow, chưa xác nhận Drive/Sheet. Đặt Webhook Respond = When Last Node Finishes, lưu và Publish workflow rồi thử lại.',
    }
  }

  const entries = (Array.isArray(payload) ? payload : [payload])
    .flatMap((item: any) => [item, item?.json, item?.data])
    .filter(Boolean)
  const matchedRow = entries.find((item: any) => {
    const hasRowNumber = item?.row_number !== undefined
      && item?.row_number !== null
      && String(item.row_number).trim() !== ''
    const hasReadyStatus = String(item?.status || '').toUpperCase() === 'READY'
    return String(item?.job_key || '') === expectedJobKey && (hasRowNumber || hasReadyStatus)
  })

  return matchedRow
    ? { ok: true, rowNumber: matchedRow.row_number, status: matchedRow.status }
    : {
        ok: false,
        code: 'N8N_SHEET_NOT_CONFIRMED',
        error: 'n8n trả HTTP 200 nhưng chưa xác nhận đã ghi Sheet cho đúng job_key. Node Sheet phải trả đúng job_key cùng row_number hoặc status READY.',
      }
}

function currentVietnamTimestamp(now = new Date()) {
  return new Date(now.getTime() + 7 * 60 * 60 * 1_000).toISOString().replace('Z', '+07:00')
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })
  const operator = await authenticatedOperator(request.headers?.authorization)
  if (!operator) return response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ để xếp lịch báo cáo.' })
  if (!['shift_leader', 'admin'].includes(operator.role) || operator.active === false) {
    return response.status(403).json({ error: 'Chỉ ca trưởng hoặc Admin được xếp lịch báo cáo.' })
  }

  const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  if (!input || input.leaderId !== operator.id) {
    return response.status(403).json({ error: 'Người chốt báo cáo không khớp phiên đăng nhập.' })
  }
  const shiftSequence = Number(input.shiftSequence)
  const requiredKinds: ReportKind[] = shiftSequence === 1 ? ['shift-1'] : shiftSequence === 2 ? ['shift-2', 'day'] : []
  const report = input.report
  if (!requiredKinds.length || !report || !requiredKinds.includes(report.kind)) {
    return response.status(400).json({ error: 'Loại báo cáo không đúng nghiệp vụ của ca.' })
  }
  if (typeof report.imageBase64 !== 'string' || !report.imageBase64.length || report.imageBase64.length > MAX_BASE64_CHARS) {
    return response.status(413).json({ error: 'Ảnh báo cáo rỗng hoặc quá lớn để đưa vào hàng đợi.' })
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(report.imageBase64)) {
    return response.status(400).json({ error: 'Dữ liệu ảnh báo cáo không đúng định dạng base64.' })
  }

  const verified = await verifyClosedShiftAndSnapshot(operator, input, shiftSequence)
  if (!verified.ok) return response.status(verified.status).json({ error: verified.error })

  const previousDelivery = verified.previousDelivery || {}
  const previousJob = previousDelivery.jobs?.[report.kind]
  const sendNow = input.sendNow === true
  if (previousJob?.queued === true && !sendNow) {
    return response.status(200).json({ mode: 'n8n', idempotent: true, job: previousJob })
  }

  if (String(process.env.N8N_REPORT_ENABLED || '').toLowerCase() !== 'true') {
    return response.status(200).json({
      mode: 'disabled',
      queued: false,
      message: 'n8n đang tắt bằng N8N_REPORT_ENABLED để kiểm thử an toàn.',
    })
  }
  const webhookUrl = process.env.N8N_REPORT_WEBHOOK_URL
  const webhookToken = process.env.N8N_REPORT_WEBHOOK_TOKEN
  if (!webhookUrl || !webhookToken) {
    return response.status(503).json({ code: 'N8N_NOT_CONFIGURED', error: 'Chưa cấu hình webhook và token n8n trên server.' })
  }

  const kind = report.kind as ReportKind
  const jobKey = `${input.branchId}:${input.businessDate}:${kind}`
  const sendAt = sendNow ? currentVietnamTimestamp() : `${input.businessDate}T${REPORT_SEND_TIMES[kind]}:00+07:00`
  const fileName = `GUSTINO-bao-cao-${kind}-${input.businessDate}.jpg`
  let webhookResponse: Response
  const webhookController = new AbortController()
  const webhookTimeout = setTimeout(() => webhookController.abort(), N8N_WEBHOOK_TIMEOUT_MS)
  try {
    webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gustino-token': webhookToken },
      signal: webhookController.signal,
      body: JSON.stringify({
        job_key: jobKey,
        branch_id: input.branchId,
        branch_name: input.branchName || input.branchId,
        business_date: input.businessDate,
        report_type: kind,
        report_label: report.label,
        send_at: sendAt,
        file_name: fileName,
        mime_type: 'image/jpeg',
        image_base64: report.imageBase64,
        send_now: sendNow,
        status: 'READY',
        attempts: 0,
      }),
    })
  } catch (error) {
    return response.status(502).json({
      code: 'N8N_WEBHOOK_FAILED',
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Webhook n8n quá thời gian phản hồi. Kiểm tra workflow đang Active và Webhook Response Mode.'
        : 'Không kết nối được webhook n8n.',
    })
  } finally {
    clearTimeout(webhookTimeout)
  }
  if (!webhookResponse.ok) {
    const error = await n8nWebhookError(webhookResponse, webhookToken)
    return response.status(502).json({ code: 'N8N_WEBHOOK_FAILED', error })
  }
  const completion = await n8nCompletedIngestion(webhookResponse, jobKey)
  if (!completion.ok) return response.status(502).json({ code: completion.code, error: completion.error })

  const job = { queued: true, jobKey, sendAt, sendNow, rowNumber: completion.rowNumber, queuedAt: new Date().toISOString() }
  const delivery = {
    ...previousDelivery,
    queued: requiredKinds.every((item) => item === kind ? true : previousDelivery.jobs?.[item]?.queued === true),
    mode: 'n8n',
    jobs: { ...(previousDelivery.jobs || {}), [kind]: job },
    updatedAt: new Date().toISOString(),
  }
  await persistDelivery(operator, verified.snapshot, input.shiftId, delivery).catch(() => null)
  return response.status(200).json({ mode: 'n8n', job })
}

async function authenticatedOperator(authorization: string | undefined) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '')
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!token || !url || !anonKey) return null
  const authResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } })
  if (!authResponse.ok) return null
  const authUser = await authResponse.json()
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,role,active`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!profileResponse.ok) return null
  const profiles = await profileResponse.json()
  return profiles?.[0] ? { ...profiles[0], accessToken: token, supabaseUrl: url, anonKey } : null
}

async function verifyClosedShiftAndSnapshot(operator: any, input: any, shiftSequence: number) {
  if (!input.shiftId || !input.branchId || !input.businessDate) {
    return { ok: false, status: 400, error: 'Thiếu mã ca, chi nhánh hoặc ngày báo cáo.' }
  }
  const headers = { apikey: operator.anonKey, Authorization: `Bearer ${operator.accessToken}`, Accept: 'application/json' }
  const params = new URLSearchParams({
    id: `eq.${input.shiftId}`,
    branch_id: `eq.${input.branchId}`,
    business_date: `eq.${input.businessDate}`,
    sequence: `eq.${shiftSequence}`,
    leader_id: `eq.${operator.id}`,
    status: 'eq.closed',
    select: 'id',
  })
  const shiftResponse = await fetch(`${operator.supabaseUrl}/rest/v1/bag_shift_sessions?${params}`, { headers })
  if (!shiftResponse.ok) return { ok: false, status: 502, error: 'Không kiểm tra được trạng thái ca trên Supabase.' }
  if (!(await shiftResponse.json())?.length) {
    return { ok: false, status: 409, error: 'Chỉ được xếp lịch sau khi chính ca trưởng đã đóng ca.' }
  }
  if (shiftSequence === 2) {
    const openParams = new URLSearchParams({ branch_id: `eq.${input.branchId}`, business_date: `eq.${input.businessDate}`, status: 'eq.open', select: 'id' })
    const openResponse = await fetch(`${operator.supabaseUrl}/rest/v1/bag_shift_sessions?${openParams}`, { headers })
    if (!openResponse.ok || (await openResponse.json())?.length) {
      return { ok: false, status: 409, error: 'Ca 2 chỉ xếp lịch cùng Tổng ngày khi không còn ca nào đang mở.' }
    }
  }
  const snapshotParams = new URLSearchParams({ branch_id: `eq.${input.branchId}`, report_date: `eq.${input.businessDate}`, select: 'id,payload', limit: '1' })
  const snapshotResponse = await fetch(`${operator.supabaseUrl}/rest/v1/report_snapshots?${snapshotParams}`, { headers })
  if (!snapshotResponse.ok) return { ok: false, status: 502, error: 'Không kiểm tra được báo cáo đã chốt.' }
  const snapshot = (await snapshotResponse.json())?.[0]
  const shiftEntry = snapshot?.payload?.shiftReports?.[input.shiftId]
  if (!shiftEntry) return { ok: false, status: 409, error: 'Báo cáo ca chưa được lưu nên chưa thể xếp lịch.' }
  return { ok: true, snapshot, previousDelivery: shiftEntry.n8nDelivery }
}

async function persistDelivery(operator: any, snapshot: any, shiftId: string, delivery: any) {
  const payload = {
    ...snapshot.payload,
    shiftReports: {
      ...snapshot.payload.shiftReports,
      [shiftId]: { ...snapshot.payload.shiftReports[shiftId], n8nDelivery: delivery },
    },
  }
  await fetch(`${operator.supabaseUrl}/rest/v1/report_snapshots?id=eq.${encodeURIComponent(snapshot.id)}`, {
    method: 'PATCH',
    headers: { apikey: operator.anonKey, Authorization: `Bearer ${operator.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  })
}
