import { getProducts } from './constants'
import { createId, readLocalJson } from './browser'
import { isDuplicateKey, isMissingRpc, isMissingUniqueConstraint, userHeaders } from './core'
import { localDateKey, localDayBoundsIso } from './dates'
import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser, InventoryReport, OperationDay, ReportSnapshot, StockLine, StockMovement } from '../types'

const USER_KEY = 'gustino_user_v1'
const LEGACY_USER_KEY = 'gustino_demo_user_v1'

async function lanApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Máy chủ đồng bộ không phản hồi.')
  return response.json() as Promise<T>
}

export function loadLocalUser(): AppUser | null {
  return readLocalJson<AppUser | null>(USER_KEY, null) || readLocalJson<AppUser | null>(LEGACY_USER_KEY, null)
}

export function saveLocalUser(user: AppUser | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
    localStorage.removeItem(LEGACY_USER_KEY)
  } catch {
    // Một số trình duyệt điện thoại chặn localStorage ở chế độ riêng tư.
  }
}

export function clearLocalBusinessCache() {
  const keep = new Set([
    USER_KEY,
    LEGACY_USER_KEY,
    'gustino_lang',
    'gustino_sidebar_collapsed',
  ])
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('gustino_') && !keep.has(key)) localStorage.removeItem(key)
    })
  } catch {
    // Best-effort cleanup. Some mobile/private browsers can block storage iteration.
  }
}

export function loadLocalMovements(): StockMovement[] {
  return []
}

export function saveLocalMovements(items: StockMovement[]) {
  void items
}

const STOCK_MOVEMENT_PAGE_SIZE = 500

async function fetchAllMovementRows(
  loadPage: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += STOCK_MOVEMENT_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + STOCK_MOVEMENT_PAGE_SIZE - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < STOCK_MOVEMENT_PAGE_SIZE) return rows
  }
}

export async function fetchMovements(branchId: string, user?: AppUser): Promise<StockMovement[]> {
  if (shouldUseLanApi(user)) {
    return lanApi<StockMovement[]>(`/movements?branchId=${encodeURIComponent(branchId)}`)
  }
  const rows = await fetchAllMovementRows((from, to) => supabase!
    .from('stock_movements')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to))
  return rows.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    productId: row.product_id,
    type: row.movement_type,
    quantity: Number(row.quantity),
    shiftDate: row.shift_date,
    note: row.note ?? '',
    createdBy: row.created_by,
    createdAt: row.created_at,
    sourceProductId: row.source_product_id ?? undefined,
    sourceQuantity: row.source_quantity ? Number(row.source_quantity) : undefined,
    documentId: row.document_id ?? undefined,
    measuredWeightKg: row.measured_weight_kg ? Number(row.measured_weight_kg) : undefined,
  }))
}

export async function addMovement(item: StockMovement, user?: AppUser): Promise<void> {
  if (shouldUseLanApi(user)) {
    await lanApi('/movements', { method: 'POST', body: JSON.stringify(item) })
    return
  }
  const { error } = await supabase!.from('stock_movements').insert({
    id: item.id,
    branch_id: item.branchId,
    product_id: item.productId,
    movement_type: item.type,
    quantity: item.quantity,
    shift_date: item.shiftDate,
    note: item.note,
    created_by: item.createdBy,
    source_product_id: item.sourceProductId ?? null,
    source_quantity: item.sourceQuantity ?? null,
    document_id: item.documentId ?? null,
    measured_weight_kg: item.measuredWeightKg ?? null,
  })
  if (error) throw error
}

export async function addMovements(
  items: StockMovement[],
  user?: AppUser,
  options?: { allowInsufficientStock?: boolean },
): Promise<void> {
  if (shouldUseLanApi(user)) {
    await lanApi('/movements', { method: 'POST', body: JSON.stringify(items) })
    return
  }
  const rows = items.map((item) => ({
    id: item.id,
    branch_id: item.branchId,
    product_id: item.productId,
    movement_type: item.type,
    quantity: item.quantity,
    shift_date: item.shiftDate,
    note: item.note,
    created_by: item.createdBy,
    source_product_id: item.sourceProductId ?? null,
    source_quantity: item.sourceQuantity ?? null,
    document_id: item.documentId ?? null,
    measured_weight_kg: item.measuredWeightKg ?? null,
  }))
  const { error } = await supabase!.rpc('create_stock_movements_checked', { p_items: rows })
  if (error) {
    // Các loại này vốn được phép ghi âm tồn (bán/hủy/kiểm kê/điều chỉnh).
    // `allowInsufficientStock` = user đã bấm "vẫn tiếp tục" (vd chưa nhập kho nhưng vẫn ghi mẻ) → cho ghi thẳng.
    const canBypassStockCheck = options?.allowInsufficientStock || items.every((item) =>
      ['sale_out', 'waste', 'count', 'adjustment'].includes(item.type),
    )
    const isStockCheckConflict = String(error.message || '').includes('Không đủ tồn')
      || String((error as any).code || '') === 'P0001'
    if (!canBypassStockCheck || !isStockCheckConflict) throw error
    await insertStockRowsDirect(rows)
  }
}

async function insertStockRowsDirect(rows: Array<{
  id: string
  branch_id: string
  product_id: string
  movement_type: StockMovement['type']
  quantity: number
  shift_date: string
  note: string
  created_by: string
  source_product_id: string | null
  source_quantity: number | null
  document_id: string | null
  measured_weight_kg: number | null
}>) {
  if (!supabase || !rows.length) return
  const { error } = await supabase!.from('stock_movements').insert(rows)
  if (error) throw error
}

export async function deleteMovements(branchId: string, movementIds: string[], user?: AppUser): Promise<void> {
  if (!movementIds.length) return
  if (shouldUseLanApi(user)) {
    await lanApi(`/movements?branchId=${encodeURIComponent(branchId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ ids: movementIds }),
    })
    return
  }
  const { error } = await supabase!
    .from('stock_movements')
    .delete()
    .eq('branch_id', branchId)
    .in('id', movementIds)
  if (error) throw error
}

export function calculateStock(movements: StockMovement[]): StockLine[] {
  const signs: Record<StockMovement['type'], number> = {
    opening: 1,
    inbound: 1,
    processing_out: -1,
    processing_in: 1,
    packing_out: -1,
    packing_in: 1,
    sale_out: -1,
    waste: -1,
    adjustment: 1,
    count: 0,
  }
  return getProducts().map((product) => {
    const productMovements = movements
      .filter((item) => item.productId === product.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const latestCount = [...productMovements]
      .filter((item) => item.type === 'count')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    const beforeCount = latestCount
      ? productMovements.filter((item) => item.createdAt < latestCount.createdAt)
      : productMovements
    const expectedAtCount = beforeCount.reduce(
      (sum, item) => {
        const informationalProcessingLoss = item.type === 'waste' && Boolean(item.sourceProductId)
        return sum + item.quantity * (informationalProcessingLoss ? 0 : signs[item.type])
      },
      0,
    )
    const afterCount = latestCount
      ? productMovements.filter((item) => item.createdAt > latestCount.createdAt)
      : []
    const expected = latestCount
      ? afterCount.reduce((sum, item) => {
          const informationalProcessingLoss = item.type === 'waste' && Boolean(item.sourceProductId)
          return sum + item.quantity * (informationalProcessingLoss ? 0 : signs[item.type])
        }, latestCount.quantity)
      : expectedAtCount
    const actual = latestCount?.quantity
    return {
      product,
      expected,
      actual,
      variance: actual === undefined ? undefined : actual - expectedAtCount,
    }
  })
}

export async function saveReportSnapshot(user: AppUser, payload: Record<string, unknown>) {
  const reportDate = typeof payload.reportDate === 'string'
    ? payload.reportDate
    : localDateKey()
  const finalizedPayload = {
    ...payload,
    reportDate,
    finalizedBy: user.id,
    finalizedByName: user.name,
    finalizedAt: new Date().toISOString(),
  }
  const snapshot = {
    id: createId(),
    branch_id: user.branchId,
    report_date: reportDate,
    created_by: user.id,
    payload: finalizedPayload,
  }
  if (shouldUseLanApi(user)) {
    await lanApi('/report-snapshots', { method: 'POST', body: JSON.stringify(snapshot) })
    return
  }
  const { error } = await supabase!.from('report_snapshots').upsert(snapshot, {
    onConflict: 'branch_id,report_date',
    ignoreDuplicates: false,
  })
  if (!error) return
  if (!isMissingUniqueConstraint(error)) throw error

  const { data: existing, error: readError } = await supabase!
    .from('report_snapshots')
    .select('id')
    .eq('branch_id', user.branchId)
    .eq('report_date', reportDate)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (readError) throw readError
  if (existing?.id) {
    const { error: updateError } = await supabase!
      .from('report_snapshots')
      .update({ payload: finalizedPayload, created_by: user.id })
      .eq('id', existing.id)
    if (updateError) throw updateError
    return
  }

  const { error: insertError } = await supabase!.from('report_snapshots').insert(snapshot)
  if (isDuplicateKey(insertError)) {
    const { error: updateError } = await supabase!
      .from('report_snapshots')
      .update({ payload: finalizedPayload, created_by: user.id })
      .eq('branch_id', user.branchId)
      .eq('report_date', reportDate)
    if (updateError) throw updateError
    return
  }
  if (insertError) throw insertError
}

export async function fetchReportSnapshots(
  branchId: string,
  user?: AppUser,
  filters: { from?: string; to?: string } = {},
): Promise<ReportSnapshot[]> {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams({ branchId })
    if (filters.from) query.set('from', filters.from)
    if (filters.to) query.set('to', filters.to)
    const result = await lanApi<ReportSnapshot[] | ReportSnapshot['payload'] | null>(
      `/report-snapshots?${query}`,
    )
    if (!result) return []
    if (Array.isArray(result)) return result.filter(Boolean)
    return [{
      id: 'lan-latest',
      branchId,
      reportDate: localDateKey(),
      payload: result,
      createdAt: new Date().toISOString(),
    }]
  }
  let request = supabase!
    .from('report_snapshots')
    .select('id, branch_id, report_date, payload, created_at')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
  if (filters.from) request = request.gte('report_date', filters.from)
  if (filters.to) request = request.lte('report_date', filters.to)
  const { data, error } = await request
  if (error) throw error
  return (data ?? []).map((item) => ({
    id: item.id,
    branchId: item.branch_id,
    reportDate: item.report_date,
    payload: item.payload,
    createdAt: item.created_at,
  }))
}

export async function saveShiftReportSnapshot(
  user: AppUser,
  businessDate: string,
  entry: {
    shiftId: string
    sequence: number
    scope: string
    leaderId: string
    leaderName: string
    report: Record<string, unknown>
    zaloIntent?: Record<string, unknown>
    zaloDelivery?: Record<string, unknown>
    n8nDelivery?: Record<string, unknown>
  },
) {
  const existing = (await fetchReportSnapshots(user.branchId, user))
    .find((item) => item.reportDate === businessDate)
  const previousPayload = existing?.payload || {}
  const previousShiftReports = previousPayload.shiftReports || {}
  await saveReportSnapshot(user, {
    ...previousPayload,
    reportDate: businessDate,
    shiftReports: {
      ...previousShiftReports,
      [entry.shiftId]: {
        ...previousShiftReports[entry.shiftId],
        ...entry,
        finalizedAt: new Date().toISOString(),
      },
    },
  })
}

export async function saveInventoryReport(report: InventoryReport, user?: AppUser): Promise<void> {
  if (shouldUseLanApi(user)) {
    await lanApi('/inventory-reports', { method: 'POST', body: JSON.stringify(report) })
    return
  }
  const { error } = await supabase!.from('inventory_reports').insert({
    id: report.id,
    report_no: report.reportNo,
    branch_id: report.branchId,
    report_date: report.reportDate,
    department: report.department,
    location: report.location,
    shift_name: report.shift,
    reporter: report.reporter,
    lines: report.lines,
    created_by: report.createdBy,
  })
  if (error) throw error
}

export async function fetchInventoryReports(branchId: string, user?: AppUser): Promise<InventoryReport[]> {
  if (shouldUseLanApi(user)) {
    return lanApi<InventoryReport[]>(`/inventory-reports?branchId=${encodeURIComponent(branchId)}`)
  }
  const { data, error } = await supabase!
    .from('inventory_reports')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((item) => ({
    id: item.id,
    reportNo: item.report_no,
    branchId: item.branch_id,
    reportDate: item.report_date,
    department: item.department,
    location: item.location,
    shift: item.shift_name,
    reporter: item.reporter,
    lines: item.lines,
    createdBy: item.created_by,
    createdAt: item.created_at,
  }))
}

export async function getOperationDay(branchId: string, businessDate: string, user?: AppUser): Promise<OperationDay | null> {
  if (shouldUseLanApi(user)) {
    return lanApi<OperationDay | null>(`/operation-day?branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(businessDate)}`)
  }
  const { data, error } = await supabase!
    .from('operation_days')
    .select('*')
    .eq('branch_id', branchId)
    .eq('business_date', businessDate)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    branchId: data.branch_id,
    businessDate: data.business_date,
    status: data.status,
    openedBy: data.opened_by,
    openedAt: data.opened_at,
    closedBy: data.closed_by ?? undefined,
    closedAt: data.closed_at ?? undefined,
  }
}

export async function ensureOperationDay(
  user: AppUser,
  businessDate: string,
  options: { allowAutoOpen?: boolean; reopenClosed?: boolean } = {},
): Promise<OperationDay> {
  const existing = await getOperationDay(user.branchId, businessDate, user)
  if (existing) {
    if (existing.status === 'closed') {
      if (!options.reopenClosed) throw new Error('Ngày vận hành đã chốt. Quản lý cần mở lại trước khi thêm phát sinh.')
      const reopened: OperationDay = {
        ...existing,
        status: 'open',
        closedBy: undefined,
        closedAt: undefined,
      }
      if (shouldUseLanApi(user)) {
        await lanApi('/operation-day', { method: 'PUT', body: JSON.stringify(reopened) })
        return reopened
      }
      const { error } = await supabase!.from('operation_days').update({
        status: 'open',
        closed_by: null,
        closed_at: null,
      }).eq('id', existing.id)
      if (error) throw error
      return reopened
    }
    return existing
  }
  if (!options.allowAutoOpen && !(await hasCheckedInForOperation(user, businessDate))) {
    throw new Error('Bạn cần check-in trong mục Chấm công trước khi mở ngày vận hành.')
  }
  const day: OperationDay = {
    id: createId(),
    branchId: user.branchId,
    businessDate,
    status: 'open',
    openedBy: user.id,
    openedAt: new Date().toISOString(),
  }
  if (shouldUseLanApi(user)) {
    await lanApi('/operation-day', { method: 'PUT', body: JSON.stringify(day) })
    return day
  }
  const { error } = await supabase!.from('operation_days').insert({
    id: day.id,
    branch_id: day.branchId,
    business_date: day.businessDate,
    status: day.status,
    opened_by: day.openedBy,
    opened_at: day.openedAt,
  })
  if (error) throw error
  return day
}

async function hasCheckedInForOperation(user: AppUser, businessDate: string) {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams({
      branchId: user.branchId,
      userId: user.id,
      from: businessDate,
      to: businessDate,
    })
    try {
      const response = await fetch(`/api/attendance/records?${query}`, { headers: userHeaders(user) })
      if (!response.ok) return false
      const records = await response.json().catch(() => [])
      return Array.isArray(records) && records.some((record) => record.userId === user.id)
    } catch {
      return false
    }
  }
  const bounds = localDayBoundsIso(businessDate)
  const { data, error } = await supabase!
    .from('attendance_records')
    .select('id')
    .eq('branch_id', user.branchId)
    .eq('user_id', user.id)
    .gte('check_in_time', bounds.startIso)
    .lte('check_in_time', bounds.endIso)
    .limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

export async function closeOperationDay(user: AppUser, businessDate: string): Promise<void> {
  const existing = await getOperationDay(user.branchId, businessDate, user)
  if (!existing) throw new Error('Ngày vận hành chưa được mở.')
  const closedAt = new Date().toISOString()
  if (shouldUseLanApi(user)) {
    await lanApi('/operation-day', {
      method: 'PUT',
      body: JSON.stringify({ ...existing, status: 'closed', closedBy: user.id, closedAt }),
    })
    return
  }
  const { error } = await supabase!.from('operation_days').update({
    status: 'closed', closed_by: user.id, closed_at: closedAt,
  }).eq('id', existing.id)
  if (error) throw error
}

export async function finalizeDailyReport(user: AppUser, businessDate: string, payload: Record<string, unknown>) {
  if (shouldUseLanApi(user)) {
    await ensureOperationDay(user, businessDate, { allowAutoOpen: true })
    await saveReportSnapshot(user, payload)
    await closeOperationDay(user, businessDate)
    return
  }
  const reportDate = typeof payload.reportDate === 'string' ? payload.reportDate : businessDate
  const finalizedPayload = {
    ...payload,
    reportDate,
    finalizedBy: user.id,
    finalizedByName: user.name,
    finalizedAt: new Date().toISOString(),
  }
  const { error } = await supabase!.rpc('finalize_daily_report', {
    p_branch_id: user.branchId,
    p_report_date: reportDate,
    p_payload: finalizedPayload,
  })
  if (!error) {
    await closeOutstandingBagLedgerForDay(user, businessDate).catch(() => undefined)
    return
  }
  if (!isMissingRpc(error, 'finalize_daily_report')) throw error

  await ensureOperationDay(user, businessDate, { allowAutoOpen: true })
  await saveReportSnapshot(user, payload)
  await closeOutstandingBagLedgerForDay(user, businessDate)
  await closeOperationDay(user, businessDate)
}

async function closeOutstandingBagLedgerForDay(user: AppUser, businessDate: string) {
  if (!supabase) return
  const endedAt = new Date().toISOString()
  const { data: sessions, error: sessionError } = await supabase
    .from('bag_shift_sessions')
    .select('id, status')
    .eq('branch_id', user.branchId)
    .eq('business_date', businessDate)
  if (sessionError) throw sessionError
  const sessionIds = (sessions || []).map((session: { id: string }) => session.id)
  if (!sessionIds.length) return

  const { data: allocations, error: allocationError } = await supabase
    .from('bag_allocations')
    .select('id, shift_id, issued_quantity, sold_quantity, damaged_quantity')
    .eq('branch_id', user.branchId)
    .in('shift_id', sessionIds)
    .is('settled_at', null)
  if (allocationError) throw allocationError

  for (const allocation of allocations || []) {
    const issued = Number(allocation.issued_quantity || 0)
    const sold = Number(allocation.sold_quantity || 0)
    const damaged = Number(allocation.damaged_quantity || 0)
    const returned = Math.max(0, issued - sold - damaged)
    const { error } = await supabase
      .from('bag_allocations')
      .update({
        returned_quantity: returned,
        settled_by: user.id,
        settlement_shift_id: allocation.shift_id,
        settled_at: endedAt,
      })
      .eq('id', allocation.id)
      .is('settled_at', null)
    if (error) throw error
  }

  const openSessionIds = (sessions || [])
    .filter((session: { id: string; status: string }) => session.status === 'open')
    .map((session: { id: string }) => session.id)
  if (!openSessionIds.length) return
  const { error: closeError } = await supabase
    .from('bag_shift_sessions')
    .update({
      status: 'closed',
      discrepancy_note: 'Auto closed by daily report.',
      ended_at: endedAt,
    })
    .in('id', openSessionIds)
    .eq('status', 'open')
  if (closeError) throw closeError
}

export async function fetchLatestReport(user: AppUser) {
  if (shouldUseLanApi(user)) {
    return lanApi(`/report-snapshots?branchId=${encodeURIComponent(user.branchId)}&latest=1`)
  }
  const { data, error } = await supabase!
    .from('report_snapshots')
    .select('payload')
    .eq('branch_id', user.branchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.payload ?? null
}

export async function saveReportDraft(user: AppUser, businessDate: string, payload: Record<string, unknown>) {
  if (!shouldUseLanApi(user)) return
  await lanApi(`/report-draft?branchId=${encodeURIComponent(user.branchId)}&date=${encodeURIComponent(businessDate)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function fetchReportDraft(user: AppUser, businessDate: string) {
  if (!shouldUseLanApi(user)) return null
  return lanApi<Record<string, unknown> | null>(
    `/report-draft?branchId=${encodeURIComponent(user.branchId)}&date=${encodeURIComponent(businessDate)}`,
  )
}
