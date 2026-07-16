const GROUP_MESSAGE_URL = 'https://openapi.zalo.me/v3.0/oa/group/message'
declare const process: { env: Record<string, string | undefined> }

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })
  const operator = await authenticatedOperator(request.headers?.authorization)
  if (!operator) return response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ để gửi Zalo.' })
  if (!['shift_leader', 'admin'].includes(operator.role) || operator.active === false) {
    return response.status(403).json({ error: 'Chỉ ca trưởng hoặc Admin được gửi báo cáo Zalo.' })
  }
  const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  if (!input || input.leaderId !== operator.id) return response.status(403).json({ error: 'Người chốt báo cáo không khớp phiên đăng nhập.' })
  const shiftSequence = Number(input.shiftSequence)
  const reportKinds = shiftSequence === 1 ? ['shift-1'] : shiftSequence === 2 ? ['shift-2', 'day'] : []
  const incomingKinds = Array.isArray(input.reportKinds) ? input.reportKinds : []
  if (!reportKinds.length || JSON.stringify(incomingKinds) !== JSON.stringify(reportKinds)) {
    return response.status(400).json({ error: 'Gói báo cáo không đúng nghiệp vụ: Ca 1 gửi một báo cáo; Ca 2 gửi Ca 2 và Tổng ngày.' })
  }
  const reports = Array.isArray(input.reports) ? input.reports : []
  if (reports.length !== reportKinds.length || reports.some((item: any, index: number) => item.kind !== reportKinds[index])) {
    return response.status(400).json({ error: 'Nội dung báo cáo không khớp thứ tự cần gửi.' })
  }
  const verified = await verifyClosedShiftAndSnapshot(operator, input, shiftSequence)
  if (!verified.ok) return response.status(verified.status).json({ error: verified.error })
  if (verified.previousDelivery?.sent === true) {
    return response.status(200).json({
      sentCount: reportKinds.length,
      messageIds: verified.previousDelivery.messageIds || [],
      mode: verified.previousDelivery.mode || 'text',
      idempotent: true,
      warning: 'Báo cáo này đã gửi Zalo thành công trước đó, hệ thống không gửi trùng.',
    })
  }
  const accessToken = process.env.ZALO_OA_ACCESS_TOKEN
  const groupId = process.env.ZALO_GMF_GROUP_ID
  if (!accessToken || !groupId) {
    return response.status(503).json({ error: 'Chưa cấu hình ZALO_OA_ACCESS_TOKEN và ZALO_GMF_GROUP_ID trên server.' })
  }
  const messageIds: string[] = []
  for (const report of reports) {
    const text = [
      `[GUSTINO] ${String(report.label || '').toLocaleUpperCase('vi')}`,
      `${input.branchName || input.branchId} · ${input.businessDate}`,
      `Ca trưởng: ${input.leaderName}`,
      `Doanh thu: ${formatMoney(Number(report.revenue || 0))}`,
      `Đã bán: ${Number(report.sold || 0).toLocaleString('vi-VN')} sản phẩm`,
      `Nhân viên bán: ${Number(report.employeeCount || 0).toLocaleString('vi-VN')}`,
    ].join('\n')
    const zaloResponse = await fetch(GROUP_MESSAGE_URL, {
      method: 'POST',
      headers: { access_token: accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { group_id: groupId }, message: { text } }),
    })
    const zaloPayload = await zaloResponse.json().catch(() => null)
    if (!zaloResponse.ok || Number(zaloPayload?.error || 0) !== 0) {
      return response.status(502).json({ error: zaloPayload?.message || 'Zalo từ chối gửi báo cáo.', sentCount: messageIds.length, messageIds })
    }
    if (zaloPayload?.data?.message_id) messageIds.push(zaloPayload.data.message_id)
  }
  const delivery = { sent: true, messageIds, mode: 'text', sentAt: new Date().toISOString() }
  await persistDelivery(operator, verified.snapshot, input.shiftId, delivery).catch(() => null)
  return response.status(200).json({
    sentCount: reports.length,
    messageIds,
    mode: 'text',
    warning: 'Đã gửi nội dung báo cáo. Ảnh infographic chờ Zalo cung cấp contract gửi ảnh GMF chính thức.',
  })
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
    return { ok: false, status: 409, error: 'Chỉ được gửi Zalo sau khi chính ca trưởng đã đóng ca.' }
  }
  if (shiftSequence === 2) {
    const openParams = new URLSearchParams({ branch_id: `eq.${input.branchId}`, business_date: `eq.${input.businessDate}`, status: 'eq.open', select: 'id' })
    const openResponse = await fetch(`${operator.supabaseUrl}/rest/v1/bag_shift_sessions?${openParams}`, { headers })
    if (!openResponse.ok || (await openResponse.json())?.length) {
      return { ok: false, status: 409, error: 'Ca 2 chỉ gửi cùng Tổng ngày khi không còn ca nào đang mở.' }
    }
  }
  const snapshotParams = new URLSearchParams({ branch_id: `eq.${input.branchId}`, report_date: `eq.${input.businessDate}`, select: 'id,payload', limit: '1' })
  const snapshotResponse = await fetch(`${operator.supabaseUrl}/rest/v1/report_snapshots?${snapshotParams}`, { headers })
  if (!snapshotResponse.ok) return { ok: false, status: 502, error: 'Không kiểm tra được báo cáo đã chốt.' }
  const snapshot = (await snapshotResponse.json())?.[0]
  const shiftEntry = snapshot?.payload?.shiftReports?.[input.shiftId]
  if (!shiftEntry) return { ok: false, status: 409, error: 'Báo cáo ca chưa được lưu nên chưa thể gửi Zalo.' }
  return { ok: true, snapshot, previousDelivery: shiftEntry.zaloDelivery }
}

async function persistDelivery(operator: any, snapshot: any, shiftId: string, delivery: any) {
  const payload = {
    ...snapshot.payload,
    shiftReports: {
      ...snapshot.payload.shiftReports,
      [shiftId]: { ...snapshot.payload.shiftReports[shiftId], zaloDelivery: delivery },
    },
  }
  await fetch(`${operator.supabaseUrl}/rest/v1/report_snapshots?id=eq.${encodeURIComponent(snapshot.id)}`, {
    method: 'PATCH',
    headers: { apikey: operator.anonKey, Authorization: `Bearer ${operator.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  })
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}
