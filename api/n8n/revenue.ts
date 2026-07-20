import { createClient } from '@supabase/supabase-js'

declare const process: { env: Record<string, string | undefined> }

// ---------------------------------------------------------------------------
// API dành riêng cho n8n (hoặc bất kỳ hệ thống ngoài nào) lấy dữ liệu doanh
// thu theo đúng logic gộp mà Dashboard Admin đang dùng (report_snapshots ưu
// tiên cao nhất -> sales_receipts -> bag_allocations -> stock_movements).
//
// LƯU Ý QUAN TRỌNG: File này KHÔNG import bất kỳ thứ gì (giá trị) từ thư mục
// `src/` — chỉ tự chứa (self-contained) trong `api/`. Vercel Node Functions
// build theo dạng ESM không tự bundle các import ra ngoài `api/`, nên import
// chéo như vậy từng gây lỗi "ERR_MODULE_NOT_FOUND" lúc chạy thật (dù build
// local không báo lỗi gì). Nếu sau này cập nhật logic tính doanh thu trong
// src/lib/revenue.ts hoặc src/lib/commission.ts, NHỚ đồng bộ lại tay vào đây.
//
// Gọi:
//   GET /api/n8n/revenue?from=2026-07-01&to=2026-07-17&branchId=xxx
//   Header: x-api-key: <N8N_API_SECRET>
//
// branchId có thể bỏ trống để lấy tất cả chi nhánh.
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Thiếu biến môi trường ${name} trên server.`)
  return value
}

function getSupabaseAdmin(): any {
  return createClient(
    process.env.SUPABASE_URL || requireEnv('VITE_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )
}

type Filters = { branchId?: string; from?: string; to?: string }

interface DailyRevenueRow {
  id: string
  branchId: string
  reportDate: string
  revenue: number
  totalSold: number
  salesRate?: number
  kpi?: number
  grade?: string
  leader?: string
  source: 'report' | 'live'
  createdAt: string
}

// ---- Giá sản phẩm (đọc từ bảng products thật trên Supabase) --------------

// Giá mặc định dự phòng nếu vì lý do gì đó không đọc được bảng products
// (copy nguyên từ src/lib/constants.ts -> defaultProductSalePrice)
function defaultProductSalePrice(productId: string): number {
  if (productId.includes('110')) return 30000
  if (productId.includes('330')) return 80000
  if (productId.includes('500')) return 120000
  if (productId.includes('1kg')) return 220000
  if (productId === 'cake-box') return 36000
  return 0
}

async function fetchProductPrices(supabase: any): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const { data, error } = await supabase
    .from('products')
    .select('id, price, deleted_at')
    .is('deleted_at', null)
  if (error) throw new Error(`products: ${error.message}`)
  ;(data ?? []).forEach((row: any) => {
    const price = Number(row.price || 0)
    if (price > 0) map.set(row.id, price)
  })
  return map
}

function priceFor(productId: string, priceMap: Map<string, number>): number {
  return priceMap.get(productId) || defaultProductSalePrice(productId)
}
function productSaleValues(productId: string, quantity: number, priceMap: Map<string, number>) {
  const price = priceFor(productId, priceMap)
  return { price, revenue: Math.round(quantity * price) }
}

function soldBagQuantity(allocation: {
  soldQuantity?: number
  settledAt?: string
  issuedQuantity: number
  returnedQuantity: number
  damagedQuantity: number
}): number {
  if (typeof allocation.soldQuantity === 'number') return Math.max(0, allocation.soldQuantity)
  return allocation.settledAt
    ? Math.max(0, allocation.issuedQuantity - allocation.returnedQuantity - allocation.damagedQuantity)
    : 0
}

// ---- report_snapshots -------------------------------------------------

async function fetchSnapshots(supabase: any, filters: Filters) {
  let query = supabase
    .from('report_snapshots')
    .select('id, branch_id, report_date, payload, created_at')
    .order('created_at', { ascending: false })
  if (filters.branchId) query = query.eq('branch_id', filters.branchId)
  if (filters.from) query = query.gte('report_date', filters.from)
  if (filters.to) query = query.lte('report_date', filters.to)
  const { data, error } = await query
  if (error) throw new Error(`report_snapshots: ${error.message}`)
  return data ?? []
}

function latestSnapshotRows(rawSnapshots: any[]): DailyRevenueRow[] {
  const sorted = [...rawSnapshots].sort((a, b) =>
    String(b.report_date).localeCompare(a.report_date) || String(b.created_at).localeCompare(a.created_at))
  const latestByDay = new Map<string, any>()
  sorted.forEach((snap) => {
    const key = `${snap.branch_id}|${snap.report_date}`
    if (!latestByDay.has(key)) latestByDay.set(key, snap)
  })
  return Array.from(latestByDay.values()).map((snap) => ({
    id: snap.id,
    branchId: snap.branch_id,
    reportDate: snap.report_date,
    revenue: snap.payload?.summary?.revenue || 0,
    totalSold: snap.payload?.summary?.totalSold || 0,
    salesRate: snap.payload?.summary?.salesRate,
    kpi: snap.payload?.summary?.kpi,
    grade: snap.payload?.summary?.grade,
    leader: snap.payload?.summary?.leader,
    source: 'report' as const,
    createdAt: snap.created_at,
  }))
}

// ---- sales_receipts -----------------------------------------------------

async function fetchReceiptsInRange(supabase: any, filters: Filters) {
  const PAGE_SIZE = 500
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('sales_receipts')
      .select('id, branch_id, business_date, total_quantity, total_amount, created_at')
      .order('business_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    if (filters.from) query = query.gte('business_date', filters.from)
    if (filters.to) query = query.lte('business_date', filters.to)
    const { data, error } = await query
if (error) throw new Error(`sales_receipts: ${error.message}`)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

function liveReceiptRows(receipts: any[]): DailyRevenueRow[] {
  const rows = new Map<string, DailyRevenueRow>()
  receipts.forEach((receipt) => {
    const key = `${receipt.branch_id}|${receipt.business_date}`
    const current = rows.get(key) || {
      id: `receipt-${key}`,
      branchId: receipt.branch_id,
      reportDate: receipt.business_date,
      revenue: 0,
      totalSold: 0,
      source: 'live' as const,
      createdAt: receipt.created_at,
    }
    current.revenue += Number(receipt.total_amount || 0)
    current.totalSold += Number(receipt.total_quantity || 0)
    if (receipt.created_at > current.createdAt) current.createdAt = receipt.created_at
    rows.set(key, current)
  })
  return Array.from(rows.values())
}

// ---- bag_allocations (theo khoảng ngày, join bag_shift_sessions) ------

async function fetchAllocationsInRange(supabase: any, filters: Filters) {
  let sessionQuery = supabase.from('bag_shift_sessions').select('id, business_date')
  if (filters.branchId) sessionQuery = sessionQuery.eq('branch_id', filters.branchId)
  if (filters.from) sessionQuery = sessionQuery.gte('business_date', filters.from)
  if (filters.to) sessionQuery = sessionQuery.lte('business_date', filters.to)
  const { data: sessions, error: sessionErr } = await sessionQuery
  if (sessionErr) throw new Error(`bag_shift_sessions: ${sessionErr.message}`)
  const sessionMap = new Map<string, string>((sessions ?? []).map((s: any) => [s.id, s.business_date]))
  const sessionIds = Array.from(sessionMap.keys())
  if (!sessionIds.length) return []

  const rows: any[] = []
  const CHUNK = 200
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunkIds = sessionIds.slice(i, i + CHUNK)
    let query = supabase
      .from('bag_allocations')
      .select('id, branch_id, shift_id, product_id, issued_quantity, sold_quantity, returned_quantity, damaged_quantity, issued_at, settled_at')
      .in('shift_id', chunkIds)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    const { data, error } = await query
    if (error) throw new Error(`bag_allocations: ${error.message}`)
    ;(data ?? []).forEach((row: any) => rows.push({ ...row, business_date: sessionMap.get(row.shift_id) }))
  }
  return rows
}

function liveAllocationRows(allocations: any[], priceMap: Map<string, number>): DailyRevenueRow[] {
  const rows = new Map<string, DailyRevenueRow & { issued: number }>()
  allocations.forEach((allocation) => {
    const reportDate = allocation.business_date || allocation.settled_at?.slice(0, 10) || allocation.issued_at?.slice(0, 10)
    if (!reportDate) return
    const sold = soldBagQuantity({
      soldQuantity: allocation.sold_quantity === null || allocation.sold_quantity === undefined
? undefined : Number(allocation.sold_quantity),
      settledAt: allocation.settled_at || undefined,
      issuedQuantity: Number(allocation.issued_quantity || 0),
      returnedQuantity: Number(allocation.returned_quantity || 0),
      damagedQuantity: Number(allocation.damaged_quantity || 0),
    })
    if (sold <= 0) return
    const key = `${allocation.branch_id}|${reportDate}`
    const current: DailyRevenueRow & { issued: number } = rows.get(key) || {      id: `live-${key}`,
      branchId: allocation.branch_id,
      reportDate,
      revenue: 0,
      totalSold: 0,
      source: 'live' as const,
      createdAt: allocation.settled_at || allocation.issued_at,
      issued: 0,
    }
    const values = productSaleValues(allocation.product_id, sold, priceMap)
    current.revenue += values.revenue
    current.totalSold += sold
    current.issued += Number(allocation.issued_quantity || 0)
    current.salesRate = current.issued ? Math.round((current.totalSold / current.issued) * 100) : 0
    const latestTime = allocation.settled_at || allocation.issued_at
    if (latestTime > current.createdAt) current.createdAt = latestTime
    rows.set(key, current)
  })
  return Array.from(rows.values()).map(({ issued: _issued, ...row }) => row)
}

// ---- stock_movements (chỉ loại sale_out) -------------------------------

async function fetchSaleOutMovements(supabase: any, filters: Filters) {
  const PAGE_SIZE = 500
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('stock_movements')
      .select('id, branch_id, product_id, quantity, shift_date, created_at')
      .eq('movement_type', 'sale_out')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    if (filters.from) query = query.gte('shift_date', filters.from)
    if (filters.to) query = query.lte('shift_date', filters.to)
    const { data, error } = await query
    if (error) throw new Error(`stock_movements: ${error.message}`)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

function liveMovementRows(movements: any[], priceMap: Map<string, number>): DailyRevenueRow[] {
  const rows = new Map<string, DailyRevenueRow>()
  movements.forEach((movement) => {
    const key = `${movement.branch_id}|${movement.shift_date}`
    const current = rows.get(key) || {
      id: `movement-${key}`,
      branchId: movement.branch_id,
      reportDate: movement.shift_date,
      revenue: 0,
      totalSold: 0,
      source: 'live' as const,
      createdAt: movement.created_at,
    }
    const values = productSaleValues(movement.product_id, Number(movement.quantity || 0), priceMap)
    current.revenue += values.revenue
    current.totalSold += Number(movement.quantity || 0)
if (movement.created_at > current.createdAt) current.createdAt = movement.created_at
    rows.set(key, current)
  })
  return Array.from(rows.values())
}

// ---- Gộp theo đúng thứ tự ưu tiên: report > receipt > allocation > movement

function buildDailyRevenueRows(
  snapshotRows: DailyRevenueRow[],
  receiptRows: DailyRevenueRow[],
  allocationRows: DailyRevenueRow[],
  movementRows: DailyRevenueRow[],
): DailyRevenueRow[] {
  // Chỉ coi là "đã có báo cáo chính thức" khi snapshot thực sự có dữ liệu
  // (revenue > 0 hoặc totalSold > 0). Snapshot rỗng (placeholder) sẽ KHÔNG
  // chặn dữ liệu live fallback xuống nữa.
  const meaningfulSnapshots = snapshotRows.filter((row) => row.revenue > 0 || row.totalSold > 0)
  const snapshotKeys = new Set(meaningfulSnapshots.map((row) => `${row.branchId}|${row.reportDate}`))

  const filteredReceipts = receiptRows.filter((row) => !snapshotKeys.has(`${row.branchId}|${row.reportDate}`))
  const receiptKeys = new Set([...snapshotKeys, ...filteredReceipts.map((row) => `${row.branchId}|${row.reportDate}`)])
  const filteredAllocations = allocationRows.filter((row) => !receiptKeys.has(`${row.branchId}|${row.reportDate}`))
  const allocationKeys = new Set([...receiptKeys, ...filteredAllocations.map((row) => `${row.branchId}|${row.reportDate}`)])
  const filteredMovements = movementRows.filter((row) => !allocationKeys.has(`${row.branchId}|${row.reportDate}`))

  const emptySnapshots = snapshotRows.filter((row) => !(row.revenue > 0 || row.totalSold > 0))
  const emptySnapshotsWithoutLiveData = emptySnapshots.filter(
    (row) => !filteredReceipts.some((r) => r.branchId === row.branchId && r.reportDate === row.reportDate)
      && !filteredAllocations.some((r) => r.branchId === row.branchId && r.reportDate === row.reportDate)
      && !filteredMovements.some((r) => r.branchId === row.branchId && r.reportDate === row.reportDate),
  )

  return [...meaningfulSnapshots, ...filteredReceipts, ...filteredAllocations, ...filteredMovements, ...emptySnapshotsWithoutLiveData]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt))
}

// ---- Handler --------------------------------------------------------------

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Chỉ hỗ trợ GET.' })
  }

  const apiKey = req.headers['x-api-key']
  const expected = process.env.N8N_API_SECRET
  if (!expected || apiKey !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined
  const from = typeof req.query.from === 'string' ? req.query.from : undefined
  const to = typeof req.query.to === 'string' ? req.query.to : undefined

  try {
    const supabase = getSupabaseAdmin()
    const filters: Filters = { branchId, from, to }
const [rawSnapshots, priceMap, rawReceipts, rawAllocations, rawMovements] = await Promise.all([
      fetchSnapshots(supabase, filters),
      fetchProductPrices(supabase),
      fetchReceiptsInRange(supabase, filters),
      fetchAllocationsInRange(supabase, filters),
      fetchSaleOutMovements(supabase, filters),
    ])

    const snapshotRows = latestSnapshotRows(rawSnapshots)
    const receiptRows = liveReceiptRows(rawReceipts)
    const allocationRows = liveAllocationRows(rawAllocations, priceMap)
    const movementRows = liveMovementRows(rawMovements, priceMap)

    const rows = buildDailyRevenueRows(snapshotRows, receiptRows, allocationRows, movementRows)

    return res.status(200).json({
      filters: { branchId: branchId ?? null, from: from ?? null, to: to ?? null },
      count: rows.length,
      rows,
    })
  } catch (err: any) {
    console.error('[n8n/revenue] error:', err)
    return res.status(500).json({ error: err?.message || 'Lỗi máy chủ khi tổng hợp doanh thu.' })
  }
}
