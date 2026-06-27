import { createId } from './browser'
import { supabase } from './supabase'
import type { AppUser, BagAllocation, BagShiftSession } from '../types'

function authHeaders(user: AppUser) {
  return {
    'Content-Type': 'application/json',
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
    'X-User-Id': user.id,
    'X-User-Role': user.role,
    'X-User-Branch': user.branchId,
    'X-User-Branches': (user.branchIds || [user.branchId]).join(','),
  }
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
  if (!response.ok) throw new Error(payload?.error || 'Không thể xử lý sổ túi theo ca.')
  return payload as T
}

export async function fetchBagShiftSessions(
  user: AppUser,
  filters: { branchId?: string; date?: string } = {},
): Promise<BagShiftSession[]> {
  if (!supabase) {
    const query = new URLSearchParams()
    if (filters.branchId) query.set('branchId', filters.branchId)
    if (filters.date) query.set('date', filters.date)
    return ledgerApi(user, `/sessions?${query}`)
  }
  let request = supabase.from('bag_shift_sessions').select('*').order('started_at', { ascending: false })
  if (filters.branchId) request = request.eq('branch_id', filters.branchId)
  if (filters.date) request = request.eq('business_date', filters.date)
  const { data, error } = await request
  if (error) throw error
  return (data || []).map(mapSession)
}

export async function fetchBagAllocations(
  user: AppUser,
  filters: { branchId?: string; date?: string } = {},
): Promise<BagAllocation[]> {
  if (!supabase) {
    const query = new URLSearchParams()
    if (filters.branchId) query.set('branchId', filters.branchId)
    if (filters.date) query.set('date', filters.date)
    return ledgerApi(user, `/allocations?${query}`)
  }
  // When filtering by date, first resolve session IDs to avoid PostgREST
  // join-filter ambiguity with the !inner syntax.
  if (filters.date) {
    let sessQuery = supabase
      .from('bag_shift_sessions')
      .select('id')
      .eq('business_date', filters.date)
    if (filters.branchId) sessQuery = sessQuery.eq('branch_id', filters.branchId)
    const { data: sessions, error: sessErr } = await sessQuery
    if (sessErr) throw sessErr
    const sessionIds = (sessions || []).map((s: { id: string }) => s.id)
    if (!sessionIds.length) return []
    let request = supabase
      .from('bag_allocations')
      .select('*, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
      .in('shift_id', sessionIds)
      .order('issued_at', { ascending: false })
    if (filters.branchId) request = request.eq('branch_id', filters.branchId)
    const { data, error } = await request
    if (error) throw error
    return (data || []).map(mapAllocation)
  }
  let request = supabase
    .from('bag_allocations')
    .select('*, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
    .order('issued_at', { ascending: false })
  if (filters.branchId) request = request.eq('branch_id', filters.branchId)
  const { data, error } = await request
  if (error) throw error
  return (data || []).map(mapAllocation)
}

export async function startBagShift(
  user: AppUser,
  businessDate: string,
  openingBalances: Record<string, number>,
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
    startedAt: new Date().toISOString(),
  }
  if (!supabase) return ledgerApi<BagShiftSession>(user, '/sessions', { method: 'POST', body: JSON.stringify(session) })
  const { data: existing, error: readError } = await supabase
    .from('bag_shift_sessions')
    .select('id')
    .eq('branch_id', user.branchId)
    .eq('status', 'open')
    .maybeSingle()
  if (readError) throw readError
  if (existing) throw new Error('Chi nhánh đang có một ca chưa bàn giao.')
  const { count, error: countError } = await supabase
    .from('bag_shift_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', user.branchId)
    .eq('business_date', businessDate)
  if (countError) throw countError
  session.sequence = (count || 0) + 1
  const { error } = await supabase.from('bag_shift_sessions').insert({
    id: session.id,
    branch_id: session.branchId,
    business_date: session.businessDate,
    sequence: session.sequence,
    leader_id: session.leaderId,
    leader_name: session.leaderName,
    status: session.status,
    opening_balances: session.openingBalances,
    started_at: session.startedAt,
  })
  if (error) throw error
  return session
}

export async function issueBags(
  user: AppUser,
  session: BagShiftSession,
  input: Pick<BagAllocation, 'employeeName' | 'employeeId' | 'productId' | 'issuedQuantity'>,
) {
  const allocation: BagAllocation = {
    id: createId(),
    branchId: session.branchId,
    shiftId: session.id,
    employeeName: input.employeeName.trim(),
    employeeId: input.employeeId,
    productId: input.productId,
    issuedQuantity: input.issuedQuantity,
    returnedQuantity: 0,
    damagedQuantity: 0,
    issuedBy: user.id,
    issuedAt: new Date().toISOString(),
  }
  if (!allocation.employeeName || allocation.issuedQuantity <= 0) throw new Error('Hãy nhập nhân viên và số túi cần phát.')
  if (!supabase) return ledgerApi<BagAllocation>(user, '/allocations', { method: 'POST', body: JSON.stringify(allocation) })
  const { error } = await supabase.from('bag_allocations').insert({
    id: allocation.id,
    branch_id: allocation.branchId,
    shift_id: allocation.shiftId,
    employee_name: allocation.employeeName,
    employee_id: allocation.employeeId || null,
    product_id: allocation.productId,
    issued_quantity: allocation.issuedQuantity,
    issued_by: allocation.issuedBy,
    issued_at: allocation.issuedAt,
  })
  if (error) throw error
  return allocation
}

export async function settleBagAllocation(
  user: AppUser,
  session: BagShiftSession,
  allocation: BagAllocation,
  soldQuantity: number,
  returnedQuantity: number,
  damagedQuantity: number,
) {
  if (soldQuantity < 0 || returnedQuantity < 0 || damagedQuantity < 0 || soldQuantity + returnedQuantity + damagedQuantity > allocation.issuedQuantity) {
    throw new Error('Số trả và số hỏng không được vượt quá số đã phát.')
  }
  const patch = {
    soldQuantity,
    returnedQuantity,
    damagedQuantity,
    settledBy: user.id,
    settlementShiftId: session.id,
    settledAt: new Date().toISOString(),
  }
  if (!supabase) {
    return ledgerApi<BagAllocation>(user, `/allocations/${allocation.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }
  const { error } = await supabase.from('bag_allocations').update({
    sold_quantity: soldQuantity,
    returned_quantity: returnedQuantity,
    damaged_quantity: damagedQuantity,
    settled_by: patch.settledBy,
    settlement_shift_id: patch.settlementShiftId,
    settled_at: patch.settledAt,
  }).eq('id', allocation.id).is('settled_at', null)
  if (error) throw error
  return { ...allocation, ...patch }
}

export async function recordBagSale(
  user: AppUser,
  allocation: BagAllocation,
  quantity: number,
) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Số túi bán phải là số nguyên lớn hơn 0.')
  const currentSold = typeof allocation.soldQuantity === 'number' ? allocation.soldQuantity : 0
  if (currentSold + quantity + allocation.returnedQuantity + allocation.damagedQuantity > allocation.issuedQuantity) {
    throw new Error('Số túi bán không được vượt quá số túi đang giữ.')
  }
  if (!supabase) {
    return ledgerApi<BagAllocation>(user, `/allocations/${allocation.id}/sale`, {
      method: 'POST',
      body: JSON.stringify({ quantity }),
    })
  }
  const { data, error } = await supabase.rpc('record_bag_sale', {
    p_allocation_id: allocation.id,
    p_quantity: quantity,
  })
  if (error) {
    const message = String(error.message || '')
    const code = String((error as any).code || '')
    const missingRpc = code === 'PGRST202'
      || message.includes('record_bag_sale')
      || message.includes('Could not find the function')
      || message.includes('404')
    if (!missingRpc) throw error
    return updateBagSaleDirect(allocation, quantity)
  }
  return mapAllocation(Array.isArray(data) ? data[0] : data)
}

async function updateBagSaleDirect(allocation: BagAllocation, quantity: number) {
  if (!supabase) return allocation
  const nextSoldQuantity = (allocation.soldQuantity || 0) + quantity
  const { data, error } = await supabase
    .from('bag_allocations')
    .update({ sold_quantity: nextSoldQuantity })
    .eq('id', allocation.id)
    .is('settled_at', null)
    .select('*, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
    .single()
  if (error) {
    throw new Error(
      'Chưa ghi được hóa đơn vì Supabase thiếu hàm record_bag_sale hoặc quyền cập nhật sold_quantity. Hãy chạy migration 20260627_pos_sales_rpc_repair.sql.',
    )
  }
  return mapAllocation(data)
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
  const patch = { closingBalances, discrepancyNote: discrepancyNote.trim(), endedAt, postedAllocationIds }
  if (!supabase) {
    return ledgerApi<BagShiftSession>(user, `/sessions/${session.id}/close`, {
      method: 'POST',
      body: JSON.stringify(patch),
    })
  }
  const { error: safeCloseError } = await supabase.rpc('close_bag_shift_safe', {
    p_session_id: session.id,
    p_closing_balances: closingBalances,
    p_discrepancy_note: patch.discrepancyNote,
    p_movements: movements,
    p_posted_allocation_ids: postedAllocationIds,
  })
  if (!safeCloseError) return
  const { error } = await supabase.from('bag_shift_sessions').update({
    status: 'closed',
    closing_balances: closingBalances,
    discrepancy_note: patch.discrepancyNote || null,
    ended_at: endedAt,
  }).eq('id', session.id).eq('status', 'open')
  if (error) throw error
  if (postedAllocationIds.length) {
    await supabase
      .from('bag_allocations')
      .update({ posted_at: endedAt })
      .in('id', postedAllocationIds)
      .is('posted_at', null)
  }
}

export async function uploadBagShiftPhoto(
  user: AppUser,
  session: BagShiftSession,
  kind: 'opening' | 'closing',
  dataUrl: string,
) {
  if (!dataUrl) return session
  if (!supabase) {
    return ledgerApi<BagShiftSession>(user, `/sessions/${session.id}/photo`, {
      method: 'POST',
      body: JSON.stringify({ kind, dataUrl }),
    })
  }
  const blob = await fetch(dataUrl).then((response) => response.blob())
  if (!blob.size) throw new Error('Ảnh bàn giao không hợp lệ.')
  const extension = blob.type.includes('png') ? 'png' : 'jpg'
  const path = `${user.branchId}/${session.businessDate}/${session.id}-${kind}-${Date.now()}.${extension}`
  const { error: uploadError } = await supabase.storage.from('shift-proofs').upload(path, blob, {
    contentType: blob.type || (extension === 'png' ? 'image/png' : 'image/jpeg'),
    upsert: false,
  })
  let url = dataUrl
  if (!uploadError) {
    const { data } = supabase.storage.from('shift-proofs').getPublicUrl(path)
    url = data.publicUrl
  }
  const column = kind === 'opening' ? 'opening_photo_url' : 'closing_photo_url'
  const { data: updated, error } = await supabase
    .from('bag_shift_sessions')
    .update({ [column]: url })
    .eq('id', session.id)
    .select('*')
    .single()
  if (error) {
    console.warn('Không thể lưu ảnh bàn giao vào ca, bỏ qua để không chặn chốt ca.', error.message)
    return { ...session, [kind === 'opening' ? 'openingPhotoUrl' : 'closingPhotoUrl']: url }
  }
  return mapSession(updated)
}

function mapSession(row: any): BagShiftSession {
  return {
    id: row.id,
    branchId: row.branch_id,
    businessDate: row.business_date,
    sequence: row.sequence,
    leaderId: row.leader_id,
    leaderName: row.leader_name,
    status: row.status,
    openingBalances: numberMap(row.opening_balances),
    closingBalances: row.closing_balances ? numberMap(row.closing_balances) : undefined,
    discrepancyNote: row.discrepancy_note || undefined,
    openingPhotoUrl: row.opening_photo_url || undefined,
    closingPhotoUrl: row.closing_photo_url || undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at || undefined,
  }
}

function mapAllocation(row: any): BagAllocation {
  return {
    id: row.id,
    branchId: row.branch_id,
    shiftId: row.shift_id,
    businessDate: row.business_date || row.bag_shift_sessions?.business_date || undefined,
    employeeName: row.employee_name,
    employeeId: row.employee_id || undefined,
    productId: row.product_id,
    issuedQuantity: Number(row.issued_quantity),
    soldQuantity: row.sold_quantity === null || row.sold_quantity === undefined ? undefined : Number(row.sold_quantity || 0),
    returnedQuantity: Number(row.returned_quantity || 0),
    damagedQuantity: Number(row.damaged_quantity || 0),
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    settledBy: row.settled_by || undefined,
    settlementShiftId: row.settlement_shift_id || undefined,
    settledAt: row.settled_at || undefined,
    postedAt: row.posted_at || undefined,
  }
}

function numberMap(value: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, quantity]) => [key, Number(quantity) || 0]))
}
