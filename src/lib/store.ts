import { PRODUCTS } from './constants'
import { createId, readLocalJson } from './browser'
import { supabase } from './supabase'
import type { AppUser, InventoryReport, OperationDay, ReportSnapshot, StockLine, StockMovement } from '../types'

const MOVEMENT_KEY = 'gustino_inventory_movements_v1'
const USER_KEY = 'gustino_user_v1'
const LEGACY_USER_KEY = 'gustino_demo_user_v1'
const INVENTORY_REPORT_KEY = 'gustino_inventory_reports_v1'
const OPERATION_DAY_KEY = 'gustino_operation_days_v1'

async function lanApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Máy chủ đồng bộ không phản hồi.')
  return response.json() as Promise<T>
}

function userHeaders(user: AppUser) {
  return {
    'Content-Type': 'application/json',
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
    'X-User-Id': user.id,
    'X-User-Role': user.role,
    'X-User-Branch': user.branchId,
    'X-User-Branches': (user.branchIds || [user.branchId]).join(','),
  }
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

export function loadLocalMovements(): StockMovement[] {
  return readLocalJson<StockMovement[]>(MOVEMENT_KEY, [])
}

export function saveLocalMovements(items: StockMovement[]) {
  try {
    localStorage.setItem(MOVEMENT_KEY, JSON.stringify(items))
  } catch {
    throw new Error('Điện thoại đang chặn lưu dữ liệu trình duyệt. Hãy tắt chế độ riêng tư hoặc cho phép dữ liệu trang web.')
  }
}

export async function fetchMovements(branchId: string): Promise<StockMovement[]> {
  if (!supabase) {
    try {
      const items = await lanApi<StockMovement[]>(`/movements?branchId=${encodeURIComponent(branchId)}`)
      const localItems = loadLocalMovements().filter((item) => item.branchId === branchId)
      if (!items.length && localItems.length) {
        await lanApi('/movements', { method: 'POST', body: JSON.stringify(localItems) })
        return localItems
      }
      saveLocalMovements(items)
      return items
    } catch {
      return loadLocalMovements().filter((item) => item.branchId === branchId)
    }
  }
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({
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

export async function addMovement(item: StockMovement): Promise<void> {
  if (!supabase) {
    await lanApi('/movements', { method: 'POST', body: JSON.stringify(item) })
    saveLocalMovements([item, ...loadLocalMovements()])
    return
  }
  const { error } = await supabase.from('stock_movements').insert({
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

export async function addMovements(items: StockMovement[]): Promise<void> {
  if (!supabase) {
    await lanApi('/movements', { method: 'POST', body: JSON.stringify(items) })
    saveLocalMovements([...items, ...loadLocalMovements()])
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
  const { error } = await supabase.rpc('create_stock_movements_checked', { p_items: rows })
  if (error) {
    const canBypassStockCheck = items.every((item) =>
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
  const { error } = await supabase.from('stock_movements').insert(rows)
  if (error) throw error
}

export async function deleteMovements(branchId: string, movementIds: string[]): Promise<void> {
  if (!movementIds.length) return
  if (!supabase) {
    await lanApi(`/movements?branchId=${encodeURIComponent(branchId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ ids: movementIds }),
    })
    const ids = new Set(movementIds)
    saveLocalMovements(loadLocalMovements().filter((item) =>
      item.branchId !== branchId || !ids.has(item.id),
    ))
    return
  }
  const { error } = await supabase
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
  return PRODUCTS.map((product) => {
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
    : new Date().toISOString().slice(0, 10)
  const snapshot = {
    id: createId(),
    branch_id: user.branchId,
    report_date: reportDate,
    created_by: user.id,
    payload: {
      ...payload,
      reportDate,
      finalizedBy: user.id,
      finalizedByName: user.name,
      finalizedAt: new Date().toISOString(),
    },
  }
  if (!supabase) {
    await lanApi('/report-snapshots', { method: 'POST', body: JSON.stringify(snapshot) })
    return
  }
  const { error } = await supabase.from('report_snapshots').upsert(snapshot, {
    onConflict: 'branch_id,report_date',
    ignoreDuplicates: false,
  })
  if (error) throw error
}

export async function fetchReportSnapshots(branchId: string): Promise<ReportSnapshot[]> {
  if (!supabase) {
    const result = await lanApi<ReportSnapshot[] | ReportSnapshot['payload'] | null>(
      `/report-snapshots?branchId=${encodeURIComponent(branchId)}`,
    )
    if (!result) return []
    if (Array.isArray(result)) return result.filter(Boolean)
    return [{
      id: 'lan-latest',
      branchId,
      reportDate: new Date().toISOString().slice(0, 10),
      payload: result,
      createdAt: new Date().toISOString(),
    }]
  }
  const { data, error } = await supabase
    .from('report_snapshots')
    .select('id, branch_id, report_date, payload, created_at')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((item) => ({
    id: item.id,
    branchId: item.branch_id,
    reportDate: item.report_date,
    payload: item.payload,
    createdAt: item.created_at,
  }))
}

export async function saveInventoryReport(report: InventoryReport): Promise<void> {
  if (!supabase) {
    await lanApi('/inventory-reports', { method: 'POST', body: JSON.stringify(report) })
    return
  }
  const { error } = await supabase.from('inventory_reports').insert({
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

export async function fetchInventoryReports(branchId: string): Promise<InventoryReport[]> {
  if (!supabase) {
    return lanApi<InventoryReport[]>(`/inventory-reports?branchId=${encodeURIComponent(branchId)}`)
  }
  const { data, error } = await supabase
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

export async function getOperationDay(branchId: string, businessDate: string): Promise<OperationDay | null> {
  if (!supabase) {
    return lanApi<OperationDay | null>(`/operation-day?branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(businessDate)}`)
  }
  const { data, error } = await supabase
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

export async function ensureOperationDay(user: AppUser, businessDate: string): Promise<OperationDay> {
  const existing = await getOperationDay(user.branchId, businessDate)
  if (existing) {
    if (existing.status === 'closed') throw new Error('Ngày vận hành đã chốt. Quản lý cần mở lại trước khi thêm phát sinh.')
    return existing
  }
  if (!(await hasCheckedInForOperation(user, businessDate))) {
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
  if (!supabase) {
    await lanApi('/operation-day', { method: 'PUT', body: JSON.stringify(day) })
    return day
  }
  const { error } = await supabase.from('operation_days').insert({
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
  if (!supabase) {
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
  const { data, error } = await supabase
    .from('attendance_records')
    .select('id')
    .eq('branch_id', user.branchId)
    .eq('user_id', user.id)
    .gte('check_in_time', `${businessDate}T00:00:00`)
    .lte('check_in_time', `${businessDate}T23:59:59`)
    .limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

export async function closeOperationDay(user: AppUser, businessDate: string): Promise<void> {
  const existing = await getOperationDay(user.branchId, businessDate)
  if (!existing) throw new Error('Ngày vận hành chưa được mở.')
  const closedAt = new Date().toISOString()
  if (!supabase) {
    await lanApi('/operation-day', {
      method: 'PUT',
      body: JSON.stringify({ ...existing, status: 'closed', closedBy: user.id, closedAt }),
    })
    return
  }
  const { error } = await supabase.from('operation_days').update({
    status: 'closed', closed_by: user.id, closed_at: closedAt,
  }).eq('id', existing.id)
  if (error) throw error
}

export async function fetchLatestReport(user: AppUser) {
  if (!supabase) {
    return lanApi(`/report-snapshots?branchId=${encodeURIComponent(user.branchId)}&latest=1`)
  }
  const { data, error } = await supabase
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
  if (supabase) return
  await lanApi(`/report-draft?branchId=${encodeURIComponent(user.branchId)}&date=${encodeURIComponent(businessDate)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function fetchReportDraft(user: AppUser, businessDate: string) {
  if (supabase) return null
  return lanApi<Record<string, unknown> | null>(
    `/report-draft?branchId=${encodeURIComponent(user.branchId)}&date=${encodeURIComponent(businessDate)}`,
  )
}
