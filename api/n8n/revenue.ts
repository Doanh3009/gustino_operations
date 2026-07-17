import { createClient } from '@supabase/supabase-js'
import { buildDailyRevenueRows } from '../../src/lib/revenue'
import type { BagAllocation, ReportSnapshot, StockMovement } from '../../src/types'
import type { SalesReceipt } from '../../src/lib/salesReceipts'

// ---------------------------------------------------------------------------
// API dành riêng cho n8n (hoặc bất kỳ hệ thống ngoài nào) lấy dữ liệu doanh
// thu theo đúng logic gộp mà Dashboard Admin đang dùng (report_snapshots ưu
// tiên cao nhất -> sales_receipts -> bag_allocations -> stock_movements).
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
process.env.SUPABASE_URL || requireEnv('VITE_SUPABASE_URL'),    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )
}

// ---- report_snapshots -------------------------------------------------

async function fetchSnapshots(
  supabase: any,
  filters: { branchId?: string; from?: string; to?: string },
): Promise<ReportSnapshot[]> {
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
    payload: row.payload,
    createdAt: row.created_at,
  }))
}

// ---- stock_movements (chỉ loại sale_out) -------------------------------

async function fetchSaleOutMovements(
  supabase: any,
  filters: { branchId?: string; from?: string; to?: string },
): Promise<StockMovement[]> {
  const PAGE_SIZE = 500
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('stock_movements')
      .select('*')
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

// ---- bag_allocations (theo khoảng ngày, join bag_shift_sessions) ------

function mapBagAllocationRow(row: any): BagAllocation {
  return {
    id: row.id,
    branchId: row.branch_id,
    shiftId: row.shift_id,
    businessDate: row.business_date || row.bag_shift_sessions?.business_date || undefined,
    employeeName: row.employee_name,
    employeeId: row.employee_id || undefined,
    productId: row.product_id,
    issuedQuantity: Number(row.issued_quantity),
    soldQuantity: row.sold_quantity === null || row.sold_quantity === undefined
      ? undefined
      : Number(row.sold_quantity || 0),
    returnedQuantity: Number(row.returned_quantity || 0),
    damagedQuantity: Number(row.damaged_quantity || 0),
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    settledBy: row.settled_by || undefined,
    settlementShiftId: row.settlement_shift_id || undefined,
    settledAt: row.settled_at || undefined,
    postedAt: row.posted_at || undefined,
    postedSoldQuantity: Number(row.posted_sold_quantity || 0),
    postedDamagedQuantity: Number(row.posted_damaged_quantity || 0),
  }
}

async function fetchAllocationsInRange(
  supabase: any,
  filters: { branchId?: string; from?: string; to?: string },
): Promise<BagAllocation[]> {
  let sessionQuery = supabase.from('bag_shift_sessions').select('id')
  if (filters.branchId) sessionQuery = sessionQuery.eq('branch_id', filters.branchId)
  if (filters.from) sessionQuery = sessionQuery.gte('business_date', filters.from)
  if (filters.to) sessionQuery = sessionQuery.lte('business_date', filters.to)
  const { data: sessions, error: sessionErr } = await sessionQuery
  if (sessionErr) throw new Error(`bag_shift_sessions: ${sessionErr.message}`)
  const sessionIds = (sessions ?? []).map((s: any) => s.id)
  if (!sessionIds.length) return []

  const rows: any[] = []
  const CHUNK = 200
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunkIds = sessionIds.slice(i, i + CHUNK)
    let query = supabase
      .from('bag_allocations')
      .select('*, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
      .in('shift_id', chunkIds)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    const { data, error } = await query
    if (error) throw new Error(`bag_allocations: ${error.message}`)
    rows.push(...(data ?? []))
  }
  return rows.map(mapBagAllocationRow)
}

// ---- sales_receipts -----------------------------------------------------

function mapReceiptRow(row: any): SalesReceipt {
  const lines = (row.sales_receipt_items || []).map((line: any) => ({
    allocationId: line.allocation_id || undefined,
    productId: line.product_id,
    productName: line.product_name,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unit_price),
    total: Number(line.line_total),
  }))
  return {
    id: row.id,
    code: row.code,
    branchId: row.branch_id,
    businessDate: row.business_date,
    sellerKey: row.seller_id || String(row.seller_name || '').trim().toLowerCase(),
    sellerId: row.seller_id || undefined,
    sellerName: row.seller_name,
    paymentMethod: row.payment_method,
    totalQuantity: Number(row.total_quantity),
    totalAmount: Number(row.total_amount),
    lines,
    createdAt: row.created_at,
    createdBy: row.created_by,
    createdByName: '',
  }
}

async function fetchReceiptsInRange(
  supabase: any,
  filters: { branchId?: string; from?: string; to?: string },
): Promise<SalesReceipt[]> {
  const PAGE_SIZE = 500
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('sales_receipts')
      .select('*, sales_receipt_items(*)')
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
  return rows.map(mapReceiptRow)
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
    const filters = { branchId, from, to }

    const [snapshots, movements, allocations, receipts] = await Promise.all([
      fetchSnapshots(supabase, filters),
      fetchSaleOutMovements(supabase, filters),
      fetchAllocationsInRange(supabase, filters),
      fetchReceiptsInRange(supabase, filters),
    ])

    const rows = buildDailyRevenueRows(snapshots, allocations, movements, {
      branchId,
      from,
      to,
      receipts,
    })

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