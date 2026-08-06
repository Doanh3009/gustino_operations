import { createId } from './browser'
import { isDuplicateKey, isMissingRpc, mapBagAllocation, mapBagShiftSession, userHeaders } from './core'
import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser, BagAllocation, BagShiftSession } from '../types'

const authHeaders = userHeaders

/**
 * A shift is owned by the persisted leader id.  Old imported rows without an
 * id can use the display-name fallback, but a matching name must never take
 * precedence over a real id from another account.
 */
export function ownsBagShiftSession(session: BagShiftSession, user: Pick<AppUser, 'id' | 'name'>) {
  const leaderId = String(session.leaderId || '').trim()
  if (leaderId) return leaderId === user.id
  return normalizeLeaderName(session.leaderName) === normalizeLeaderName(user.name)
}

export function latestOwnedBagShiftSession(
  sessions: BagShiftSession[],
  user: Pick<AppUser, 'id' | 'name'>,
) {
  return sessions
    .filter((session) => ownsBagShiftSession(session, user))
    .sort((a, b) => b.sequence - a.sequence || b.startedAt.localeCompare(a.startedAt))[0]
}

function normalizeLeaderName(value: string) {
  return String(value || '').trim().toLocaleLowerCase('vi').normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

async function ledgerApi<T>(user: AppUser, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/shift-ledger${path}`, {
    ...init,
    headers: { ...authHeaders(user), ...(init?.headers || {}) },
  })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('Máy chủ bàn giao ca chưa hoạt động. Hãy khởi động lại ứng dụng.')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Không thể xử lý bàn giao ca.')
  return payload as T
}

export async function fetchBagShiftSessions(
  user: AppUser,
  filters: { branchId?: string; date?: string; from?: string; to?: string } = {},
): Promise<BagShiftSession[]> {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams()
    if (filters.branchId) query.set('branchId', filters.branchId)
    if (filters.date) query.set('date', filters.date)
    if (filters.from) query.set('from', filters.from)
    if (filters.to) query.set('to', filters.to)
    return ledgerApi(user, `/sessions?${query}`)
  }
  let request = supabase!.from('bag_shift_sessions').select('*').order('started_at', { ascending: false })
  if (filters.branchId) request = request.eq('branch_id', filters.branchId)
  if (filters.date) request = request.eq('business_date', filters.date)
  if (filters.from) request = request.gte('business_date', filters.from)
  if (filters.to) request = request.lte('business_date', filters.to)
  const { data, error } = await request
  if (error) throw error
  return (data || []).map(mapBagShiftSession)
}

export async function fetchBagAllocations(
  user: AppUser,
  filters: { branchId?: string; date?: string } = {},
): Promise<BagAllocation[]> {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams()
    if (filters.branchId) query.set('branchId', filters.branchId)
    if (filters.date) query.set('date', filters.date)
    return ledgerApi(user, `/allocations?${query}`)
  }
  // When filtering by date, first resolve session IDs to avoid PostgREST
  // join-filter ambiguity with the !inner syntax.
  if (filters.date) {
    let sessQuery = supabase!
      .from('bag_shift_sessions')
      .select('id')
      .eq('business_date', filters.date)
    if (filters.branchId) sessQuery = sessQuery.eq('branch_id', filters.branchId)
    const { data: sessions, error: sessErr } = await sessQuery
    if (sessErr) throw sessErr
    const sessionIds = (sessions || []).map((s: { id: string }) => s.id)
    if (!sessionIds.length) return []
    let request = supabase!
      .from('bag_allocations')
      .select('*, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
      .in('shift_id', sessionIds)
      .order('issued_at', { ascending: false })
    if (filters.branchId) request = request.eq('branch_id', filters.branchId)
    const { data, error } = await request
    if (error) throw error
    return (data || []).map(mapBagAllocation)
  }
  let request = supabase!
    .from('bag_allocations')
    .select('*, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
    .order('issued_at', { ascending: false })
  if (filters.branchId) request = request.eq('branch_id', filters.branchId)
  const { data, error } = await request
  if (error) throw error
  return (data || []).map(mapBagAllocation)
}

export async function startBagShift(
  user: AppUser,
  businessDate: string,
  openingBalances: Record<string, number>,
  options: { note?: string } = {},
) {
  const session: BagShiftSession = {
    id: createId(),
    branchId: user.branchId,
    businessDate,
    sequence: 0,
    leaderId: user.id,
    leaderName: user.name,
    status: 'open',
    openingBalances,
    discrepancyNote: options.note?.trim() || undefined,
    startedAt: new Date().toISOString(),
  }
  if (shouldUseLanApi(user)) return ledgerApi<BagShiftSession>(user, '/sessions', { method: 'POST', body: JSON.stringify(session) })
  const { count, error: countError } = await supabase!
    .from('bag_shift_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', user.branchId)
    .eq('business_date', businessDate)
  if (countError) throw countError
  if ((count || 0) >= 2) throw new Error('Hôm nay đã đủ 2 ca (Ca sáng và Ca tối). Không thể nhận thêm ca mới.')

  const { data: openSessions, error: readError } = await supabase!
    .from('bag_shift_sessions')
    .select('id,business_date,started_at')
    .eq('branch_id', user.branchId)
    .eq('status', 'open')
    .order('started_at', { ascending: true })
    .limit(10)
  if (readError) throw readError
  const openToday = (openSessions || []).find((item: { business_date: string }) => item.business_date === businessDate)
  if (openToday) throw new Error('Chi nhánh đang có một ca chưa bàn giao.')
  for (const stale of openSessions || []) {
    await closeStaleOpenBagShift(user, stale.id)
  }
  session.sequence = (count || 0) + 1
  const { error } = await supabase!.from('bag_shift_sessions').insert({
    id: session.id,
    branch_id: session.branchId,
    business_date: session.businessDate,
    sequence: session.sequence,
    leader_id: session.leaderId,
    leader_name: session.leaderName,
    status: session.status,
    opening_balances: session.openingBalances,
    discrepancy_note: session.discrepancyNote || null,
    started_at: session.startedAt,
  })
  if (error) throw error
  return session
}

/**
 * Chuyển quyền chủ ca sang ca trưởng.
 * Chủ ca phải là ca trưởng, nhưng ca phó có thể lỡ mở ca trước (check-in sớm
 * hơn vài giây, hoặc mở thay khi ca trưởng chưa tới). Khi ca trưởng đúng lịch
 * vào app, phiên ca được trả về đúng người. Ca phó không mất gì: vẫn nhập kho,
 * chế biến và bán hàng trong ca, chỉ không đứng tên phiên ca.
 */
export async function transferBagShiftLeadership(
  user: AppUser,
  session: BagShiftSession,
  reason: string,
): Promise<BagShiftSession> {
  const note = appendSessionNote(session.discrepancyNote, `[CHỦ CA] ${reason}`)
  if (shouldUseLanApi(user)) {
    return ledgerApi<BagShiftSession>(user, `/sessions/${session.id}/leader`, {
      method: 'POST',
      body: JSON.stringify({ leaderId: user.id, leaderName: user.name, discrepancyNote: note }),
    })
  }
  const { error } = await supabase!
    .from('bag_shift_sessions')
    .update({ leader_id: user.id, leader_name: user.name, discrepancy_note: note })
    .eq('id', session.id)
    .eq('status', 'open')
  if (error) throw error
  return { ...session, leaderId: user.id, leaderName: user.name, discrepancyNote: note }
}

/** Ghi chú ca là nhật ký cộng dồn — không bao giờ đè mất ghi chú đã có. */
export function appendSessionNote(existing: string | undefined, line: string) {
  const current = String(existing || '').trim()
  if (current.includes(line)) return current
  return current ? `${current}\n${line}` : line
}

async function closeStaleOpenBagShift(user: AppUser, sessionId: string) {
  const endedAt = new Date().toISOString()
  const { data: allocations, error: readAllocationsError } = await supabase!
    .from('bag_allocations')
    .select('id, issued_quantity, sold_quantity, damaged_quantity')
    .eq('shift_id', sessionId)
    .is('settled_at', null)
  if (readAllocationsError) throw readAllocationsError

  for (const allocation of allocations || []) {
    const issued = Number(allocation.issued_quantity || 0)
    const sold = Number(allocation.sold_quantity || 0)
    const damaged = Number(allocation.damaged_quantity || 0)
    const returned = Math.max(0, issued - sold - damaged)
    const { error } = await supabase!
      .from('bag_allocations')
      .update({
        returned_quantity: returned,
        settled_by: user.id,
        settlement_shift_id: sessionId,
        settled_at: endedAt,
      })
      .eq('id', allocation.id)
      .is('settled_at', null)
    if (error) throw error
  }

  const { error } = await supabase!
    .from('bag_shift_sessions')
    .update({
      status: 'closed',
      discrepancy_note: 'Auto closed when opening a new business day.',
      ended_at: endedAt,
    })
    .eq('id', sessionId)
    .eq('status', 'open')
  if (error) throw error
}

export async function closeBagShift(
  user: AppUser,
  session: BagShiftSession,
  closingBalances: Record<string, number>,
  discrepancyNote: string,
  postedAllocationIds: string[],
  movements: Array<{
    id: string
    product_id: string
    movement_type: string
    quantity: number
    shift_date: string
    note: string
    document_id?: string | null
    source_product_id?: string | null
    source_quantity?: number | null
    measured_weight_kg?: number | null
    created_at?: string
  }> = [],
) {
  const endedAt = new Date().toISOString()
  const patch = { closingBalances, discrepancyNote: discrepancyNote.trim(), endedAt, postedAllocationIds, movements }
  if (shouldUseLanApi(user)) {
    return ledgerApi<BagShiftSession>(user, `/sessions/${session.id}/close`, {
      method: 'POST',
      body: JSON.stringify(patch),
    })
  }
  const { error: safeCloseError } = await supabase!.rpc('close_bag_shift_safe', {
    p_session_id: session.id,
    p_closing_balances: closingBalances,
    p_discrepancy_note: patch.discrepancyNote,
    p_movements: [],
    p_posted_allocation_ids: postedAllocationIds,
  })
  if (!safeCloseError) return
  if (!isMissingRpc(safeCloseError, 'close_bag_shift_safe') && !isRecoverableSafeCloseError(safeCloseError)) {
    throw safeCloseError
  }
  await closeBagShiftDirect(user, session, closingBalances, patch.discrepancyNote, postedAllocationIds, movements, endedAt)
}

/**
 * Mở lại ca vừa chốt nhầm (BUG-114). Toàn bộ phần hoàn tác số liệu kho nằm trong
 * RPC `reopen_bag_shift` để chốt lại lần sau không cộng đôi; client chỉ gọi và
 * dịch lỗi sang tiếng Việt.
 */
export async function reopenBagShift(user: AppUser, session: BagShiftSession, reason = '') {
  if (shouldUseLanApi(user)) {
    return ledgerApi<BagShiftSession>(user, `/sessions/${session.id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  }
  const { error } = await supabase!.rpc('reopen_bag_shift', {
    p_session_id: session.id,
    p_reason: reason,
  })
  if (!error) return
  if (isMissingRpc(error, 'reopen_bag_shift')) {
    throw new Error('Máy chủ chưa có chức năng mở lại ca. Hãy chạy migration 20260724_reopen_bag_shift.sql rồi thử lại.')
  }
  const message = String(error.message || '')
  if (/mo lai duoc ca trong ngay/i.test(message)) {
    throw new Error('Chỉ mở lại được ca của hôm nay. Ca ngày cũ phải nhờ quản lý mở lại ngày vận hành.')
  }
  if (/Ngay van hanh da chot/i.test(message)) {
    throw new Error('Ngày vận hành đã chốt. Hãy mở lại ngày trước khi mở lại ca.')
  }
  if (/Khong co quyen/i.test(message)) {
    throw new Error('Tài khoản này không có quyền mở lại ca tại chi nhánh đó.')
  }
  throw error
}

async function closeBagShiftDirect(
  user: AppUser,
  session: BagShiftSession,
  closingBalances: Record<string, number>,
  discrepancyNote: string,
  postedAllocationIds: string[],
  movements: Array<{
    id: string
    product_id: string
    movement_type: string
    quantity: number
    shift_date: string
    note: string
    document_id?: string | null
    source_product_id?: string | null
    source_quantity?: number | null
    measured_weight_kg?: number | null
    created_at?: string
  }>,
  endedAt: string,
) {
  if (movements.length) {
    const rows = movements.map((movement) => ({
      id: movement.id,
      branch_id: session.branchId,
      product_id: movement.product_id,
      movement_type: movement.movement_type,
      quantity: movement.quantity,
      shift_date: movement.shift_date,
      note: movement.note,
      document_id: movement.document_id || session.id,
      source_product_id: movement.source_product_id || null,
      source_quantity: movement.source_quantity || null,
      measured_weight_kg: movement.measured_weight_kg || null,
      created_by: user.id,
      // Bỏ trống = để `stock_movements.created_at` dùng `default now()` của máy
      // chủ. `endedAt` cũng là đồng hồ MÁY nên không dùng làm mốc kiểm kê được:
      // phiếu `count` đặt sai vị trí thời gian là tồn tính sai (xem BUG-134).
      ...(movement.created_at ? { created_at: movement.created_at } : {}),
    }))
    for (const row of rows) await insertStockMovementIfMissing(row)
  }
  const { error } = await supabase!.from('bag_shift_sessions').update({
    status: 'closed',
    closing_balances: closingBalances,
    discrepancy_note: discrepancyNote || null,
    ended_at: endedAt,
  }).eq('id', session.id).eq('status', 'open')
  if (error) throw error
  if (postedAllocationIds.length) {
    const { data: postedRows, error: postedReadError } = await supabase!
      .from('bag_allocations')
      .select('id, sold_quantity, damaged_quantity')
      .in('id', postedAllocationIds)
    if (postedReadError) throw postedReadError
    const quantityUpdates = (postedRows || []).map((row: any) => supabase!
      .from('bag_allocations')
      .update({
        posted_at: endedAt,
        posted_sold_quantity: Number(row.sold_quantity || 0),
        posted_damaged_quantity: Number(row.damaged_quantity || 0),
      })
      .eq('id', row.id))
    const quantityResults = await Promise.all(quantityUpdates)
    const postedQuantityError = quantityResults.find((result) => result.error)?.error
    if (!postedQuantityError) return
    const message = String(postedQuantityError.message || '')
    if (!/posted_sold_quantity|posted_damaged_quantity|column/i.test(message)) throw postedQuantityError
    await supabase!
      .from('bag_allocations')
      .update({ posted_at: endedAt })
      .in('id', postedAllocationIds)
      .is('posted_at', null)
  }
}

async function insertStockMovementIfMissing(row: {
  id: string
  branch_id: string
  product_id: string
  movement_type: string
  quantity: number
  shift_date: string
  note: string
  document_id: string | null
  source_product_id: string | null
  source_quantity: number | null
  measured_weight_kg: number | null
  created_by: string
  created_at?: string
}) {
  if (row.document_id) {
    const { data: existing, error: readError } = await supabase!
      .from('stock_movements')
      .select('id')
      .eq('document_id', row.document_id)
      .eq('product_id', row.product_id)
      .eq('movement_type', row.movement_type)
      .maybeSingle()
    if (readError && !isConflictError(readError)) throw readError
    if (existing) return
  }
  const { error } = await supabase!.from('stock_movements').insert(row)
  if (error && !isDuplicateKey(error) && !isConflictError(error)) throw error
}

export async function uploadBagShiftPhoto(
  user: AppUser,
  session: BagShiftSession,
  kind: 'opening' | 'closing',
  dataUrl: string,
) {
  if (!dataUrl) return session
  if (shouldUseLanApi(user)) {
    return ledgerApi<BagShiftSession>(user, `/sessions/${session.id}/photo`, {
      method: 'POST',
      body: JSON.stringify({ kind, dataUrl }),
    })
  }
  const blob = await fetch(dataUrl).then((response) => response.blob())
  if (!blob.size) throw new Error('Ảnh bàn giao không hợp lệ.')
  const extension = blob.type.includes('png') ? 'png' : 'jpg'
  const path = `${user.branchId}/${session.businessDate}/${session.id}-${kind}-${Date.now()}.${extension}`
  const { error: uploadError } = await supabase!.storage.from('shift-proofs').upload(path, blob, {
    contentType: blob.type || (extension === 'png' ? 'image/png' : 'image/jpeg'),
    upsert: false,
  })
  let url = dataUrl
  if (!uploadError) {
    const { data } = supabase!.storage.from('shift-proofs').getPublicUrl(path)
    url = data.publicUrl
  } else if (isMissingShiftProofStorage(uploadError)) {
    url = dataUrl
  } else {
    console.warn('Không thể upload ảnh bàn giao lên storage, lưu tạm vào sổ ca.', uploadError.message)
  }
  const column = kind === 'opening' ? 'opening_photo_url' : 'closing_photo_url'
  const { data: updated, error } = await supabase!
    .from('bag_shift_sessions')
    .update({ [column]: url })
    .eq('id', session.id)
    .select('*')
    .single()
  if (error) {
    // Không nuốt lỗi im lặng nữa: người dùng cần biết ảnh chưa vào báo cáo.
    if (isMissingPhotoColumn(error)) {
      throw new Error('Ảnh chưa lưu được vào sổ ca: Supabase thiếu cột ảnh. Hãy chạy migration 20260702_shift_proofs_and_master_products.sql.')
    }
    throw new Error(`Ảnh chưa lưu được vào sổ ca: ${error.message}`)
  }
  return mapBagShiftSession(updated)
}

function isConflictError(error: unknown) {
  const err = error as { code?: string; status?: number; message?: string } | null
  return String(err?.code || '') === '409'
    || Number(err?.status || 0) === 409
    || /409|conflict/i.test(String(err?.message || ''))
}

function isRecoverableSafeCloseError(error: unknown) {
  const err = error as { code?: string; status?: number; message?: string } | null
  const message = String(err?.message || '')
  return isConflictError(error)
    || String(err?.code || '') === 'P0001'
    || /duplicate key|already exists|stock_movements|schema cache/i.test(message)
}

function isMissingShiftProofStorage(error: unknown) {
  const err = error as { statusCode?: string; status?: number; message?: string; error?: string } | null
  const message = `${err?.message || ''} ${err?.error || ''}`
  return Number(err?.status || 0) === 400
    || String(err?.statusCode || '') === '400'
    || /bucket|storage|not found|does not exist|bad request/i.test(message)
}

function isMissingPhotoColumn(error: unknown) {
  const message = String((error as { message?: string } | null)?.message || '')
  return /opening_photo_url|closing_photo_url|schema cache|column/i.test(message)
}
