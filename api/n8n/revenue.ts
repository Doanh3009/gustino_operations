import { createClient } from '@supabase/supabase-js'

declare const process: { env: Record<string, string | undefined> }

interface RevenueFilters {
  branchId?: string
  from?: string
  to?: string
}

interface ReportSnapshot {
  id: string
  branchId: string
  reportDate: string
  payload: { summary?: { revenue?: number; totalSold?: number; salesRate?: number; kpi?: number; grade?: string; leader?: string } }
  createdAt: string
}

interface StockMovement {
  id: string
  branchId: string
  productId: string
  quantity: number
  shiftDate: string
  createdAt: string
}

interface BagAllocation {
  id: string
  branchId: string
  businessDate?: string
  productId: string
  issuedQuantity: number
  soldQuantity?: number
  returnedQuantity: number
  damagedQuantity: number
  settledAt?: string
  issuedAt: string
}

interface SalesReceipt {
  id: string
  branchId: string
  businessDate: string
  totalQuantity: number
  totalAmount: number
  createdAt: string
}

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

// API server-standalone: do not import frontend modules that depend on import.meta.env.
// Precedence intentionally matches the Admin dashboard:
// report snapshot > POS receipt > bag allocation > sale_out movement.

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Thiếu biến môi trường ${name} trên server.`)
  return value
}

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL || requireEnv('VITE_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )
}

async function fetchSnapshots(supabase: any, filters: RevenueFilters): Promise<ReportSnapshot[]> {
  let query = supabase
    .from('report_snapshots')
    .select('id, branch_id, report_date, payload, created_at')
    .order('created_at', { ascending: false })
  if (filters.branchId) query = query.eq('branch_id', filters.branchId)
  if (filters.from) query = query.gte('report_date', filters.from)
  if (filters.to) query = query.lte('report_date', filters.to)
  const { data, error } = await query
  if (error) throw new Error(`report_snapshots: ${error.message}`)
  return (data ?? []).map((row: any) => ({
    id: row.id,
    branchId: row.branch_id,
    reportDate: row.report_date,
    payload: row.payload || {},
    createdAt: row.created_at,
  }))
}

async function fetchSaleOutMovements(supabase: any, filters: RevenueFilters): Promise<StockMovement[]> {
  const pageSize = 500
  const rows: any[] = []
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from('stock_movements')
      .select('id, branch_id, product_id, quantity, shift_date, created_at')
      .eq('movement_type', 'sale_out')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    if (filters.from) query = query.gte('shift_date', filters.from)
    if (filters.to) query = query.lte('shift_date', filters.to)
    const { data, error } = await query
    if (error) throw new Error(`stock_movements: ${error.message}`)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    productId: row.product_id,
    quantity: Number(row.quantity),
    shiftDate: row.shift_date,
    createdAt: row.created_at,
  }))
}

function mapBagAllocationRow(row: any): BagAllocation {
  return {
    id: row.id,
    branchId: row.branch_id,
    businessDate: row.business_date || row.bag_shift_sessions?.business_date || undefined,
    productId: row.product_id,
    issuedQuantity: Number(row.issued_quantity),
    soldQuantity: row.sold_quantity === null || row.sold_quantity === undefined ? undefined : Number(row.sold_quantity || 0),
    returnedQuantity: Number(row.returned_quantity || 0),
    damagedQuantity: Number(row.damaged_quantity || 0),
    settledAt: row.settled_at || undefined,
    issuedAt: row.issued_at,
  }
}

async function fetchAllocationsInRange(supabase: any, filters: RevenueFilters): Promise<BagAllocation[]> {
  let sessionQuery = supabase.from('bag_shift_sessions').select('id')
  if (filters.branchId) sessionQuery = sessionQuery.eq('branch_id', filters.branchId)
  if (filters.from) sessionQuery = sessionQuery.gte('business_date', filters.from)
  if (filters.to) sessionQuery = sessionQuery.lte('business_date', filters.to)
  const { data: sessions, error: sessionError } = await sessionQuery
  if (sessionError) throw new Error(`bag_shift_sessions: ${sessionError.message}`)
  const sessionIds = (sessions ?? []).map((session: any) => session.id)
  if (!sessionIds.length) return []

  const rows: any[] = []
  const chunkSize = 200
  for (let index = 0; index < sessionIds.length; index += chunkSize) {
    let query = supabase
      .from('bag_allocations')
      .select('id, branch_id, product_id, issued_quantity, sold_quantity, returned_quantity, damaged_quantity, settled_at, issued_at, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
      .in('shift_id', sessionIds.slice(index, index + chunkSize))
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    const { data, error } = await query
    if (error) throw new Error(`bag_allocations: ${error.message}`)
    rows.push(...(data ?? []))
  }
  return rows.map(mapBagAllocationRow)
}

async function fetchReceiptsInRange(supabase: any, filters: RevenueFilters): Promise<SalesReceipt[]> {
  const pageSize = 500
  const rows: any[] = []
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from('sales_receipts')
      .select('id, branch_id, business_date, total_quantity, total_amount, created_at')
      .order('business_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    if (filters.from) query = query.gte('business_date', filters.from)
    if (filters.to) query = query.lte('business_date', filters.to)
    const { data, error } = await query
    if (error) throw new Error(`sales_receipts: ${error.message}`)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    businessDate: row.business_date,
    totalQuantity: Number(row.total_quantity),
    totalAmount: Number(row.total_amount),
    createdAt: row.created_at,
  }))
}

async function fetchProductPrices(supabase: any) {
  const { data, error } = await supabase.from('products').select('id, price')
  if (error) throw new Error(`products: ${error.message}`)
  return new Map<string, number>((data ?? []).map((row: any) => [row.id, Number(row.price || 0)]))
}

const fallbackProductPrices: Record<string, number> = {
  'chestnut-110': 33000,
  'snow-110': 33000,
  'grilled-110': 33000,
  'chestnut-330': 89000,
  'snow-330': 89000,
  'grilled-330': 89000,
  'chestnut-500': 169000,
  'snow-500': 169000,
  'grilled-500': 169000,
  'chestnut-1kg': 330000,
  'snow-1kg': 330000,
  'grilled-1kg': 330000,
  'potato-500': 48000,
  'potato-1kg': 80000,
  'cake-box': 36000,
}

function soldBagQuantity(allocation: BagAllocation) {
  if (typeof allocation.soldQuantity === 'number') return Math.max(0, allocation.soldQuantity)
  return allocation.settledAt
    ? Math.max(0, allocation.issuedQuantity - allocation.returnedQuantity - allocation.damagedQuantity)
    : 0
}

function productRevenue(productId: string, quantity: number, prices: Map<string, number>) {
  const price = prices.get(productId) || fallbackProductPrices[productId] || 0
  return Math.round(quantity * price)
}

function buildDailyRevenueRows(
  snapshots: ReportSnapshot[],
  allocations: BagAllocation[],
  movements: StockMovement[],
  receipts: SalesReceipt[],
  productPrices: Map<string, number>,
) {
  const latestSnapshots = new Map<string, ReportSnapshot>()
  snapshots.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach((snapshot) => {
    const key = `${snapshot.branchId}|${snapshot.reportDate}`
    if (!latestSnapshots.has(key)) latestSnapshots.set(key, snapshot)
  })
  const snapshotRows: DailyRevenueRow[] = Array.from(latestSnapshots.values()).map((snapshot) => ({
    id: snapshot.id,
    branchId: snapshot.branchId,
    reportDate: snapshot.reportDate,
    revenue: Number(snapshot.payload.summary?.revenue || 0),
    totalSold: Number(snapshot.payload.summary?.totalSold || 0),
    salesRate: snapshot.payload.summary?.salesRate,
    kpi: snapshot.payload.summary?.kpi,
    grade: snapshot.payload.summary?.grade,
    leader: snapshot.payload.summary?.leader,
    source: 'report',
    createdAt: snapshot.createdAt,
  }))
  const snapshotKeys = new Set(snapshotRows.map((row) => `${row.branchId}|${row.reportDate}`))

  const receiptMap = new Map<string, DailyRevenueRow>()
  receipts.forEach((receipt) => {
    const key = `${receipt.branchId}|${receipt.businessDate}`
    if (snapshotKeys.has(key)) return
    const row = receiptMap.get(key) || {
      id: `receipt-${key}`,
      branchId: receipt.branchId,
      reportDate: receipt.businessDate,
      revenue: 0,
      totalSold: 0,
      source: 'live',
      createdAt: receipt.createdAt,
    }
    row.revenue += receipt.totalAmount
    row.totalSold += receipt.totalQuantity
    if (receipt.createdAt > row.createdAt) row.createdAt = receipt.createdAt
    receiptMap.set(key, row)
  })
  const receiptRows = Array.from(receiptMap.values())
  const receiptKeys = new Set([...snapshotKeys, ...receiptRows.map((row) => `${row.branchId}|${row.reportDate}`)])

  const allocationMap = new Map<string, DailyRevenueRow & { issued: number }>()
  allocations.forEach((allocation) => {
    const reportDate = allocation.businessDate || allocation.settledAt?.slice(0, 10) || allocation.issuedAt.slice(0, 10)
    const key = `${allocation.branchId}|${reportDate}`
    if (receiptKeys.has(key)) return
    const sold = soldBagQuantity(allocation)
    if (sold <= 0) return
    const row = allocationMap.get(key) || {
      id: `allocation-${key}`,
      branchId: allocation.branchId,
      reportDate,
      revenue: 0,
      totalSold: 0,
      source: 'live',
      createdAt: allocation.settledAt || allocation.issuedAt,
      issued: 0,
    }
    row.revenue += productRevenue(allocation.productId, sold, productPrices)
    row.totalSold += sold
    row.issued += allocation.issuedQuantity
    row.salesRate = row.issued ? Math.round(row.totalSold / row.issued * 100) : 0
    allocationMap.set(key, row)
  })
  const allocationRows: DailyRevenueRow[] = Array.from(allocationMap.values()).map(({ issued: _issued, ...row }) => row)
  const allocationKeys = new Set([...receiptKeys, ...allocationRows.map((row) => `${row.branchId}|${row.reportDate}`)])

  const movementMap = new Map<string, DailyRevenueRow>()
  movements.forEach((movement) => {
    const key = `${movement.branchId}|${movement.shiftDate}`
    if (allocationKeys.has(key)) return
    const row = movementMap.get(key) || {
      id: `movement-${key}`,
      branchId: movement.branchId,
      reportDate: movement.shiftDate,
      revenue: 0,
      totalSold: 0,
      source: 'live',
      createdAt: movement.createdAt,
    }
    row.revenue += productRevenue(movement.productId, movement.quantity, productPrices)
    row.totalSold += movement.quantity
    if (movement.createdAt > row.createdAt) row.createdAt = movement.createdAt
    movementMap.set(key, row)
  })

  return [...snapshotRows, ...receiptRows, ...allocationRows, ...movementMap.values()]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt))
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Chỉ hỗ trợ GET.' })
  }

  const apiKey = req.headers['x-api-key']
  const expected = process.env.N8N_API_SECRET
  if (!expected || apiKey !== expected) return res.status(401).json({ error: 'Unauthorized' })

  const filters: RevenueFilters = {
    branchId: typeof req.query.branchId === 'string' ? req.query.branchId : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  }

  try {
    const supabase = getSupabaseAdmin()
    const [snapshots, movements, allocations, receipts, productPrices] = await Promise.all([
      fetchSnapshots(supabase, filters),
      fetchSaleOutMovements(supabase, filters),
      fetchAllocationsInRange(supabase, filters),
      fetchReceiptsInRange(supabase, filters),
      fetchProductPrices(supabase),
    ])
    const rows = buildDailyRevenueRows(snapshots, allocations, movements, receipts, productPrices)
    return res.status(200).json({
      filters: { branchId: filters.branchId ?? null, from: filters.from ?? null, to: filters.to ?? null },
      count: rows.length,
      rows,
    })
  } catch (error: any) {
    console.error('[n8n/revenue] error:', error)
    return res.status(500).json({ error: error?.message || 'Lỗi máy chủ khi tổng hợp doanh thu.' })
  }
}
