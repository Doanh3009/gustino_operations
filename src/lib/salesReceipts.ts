import { userHeaders } from './core'
import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser } from '../types'

export type PaymentMethod = 'cash' | 'qr' | 'card'

export interface SalesReceiptLine {
  allocationId?: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  total: number
}

export interface SalesReceipt {
  id: string
  code: string
  branchId: string
  businessDate: string
  sellerKey: string
  sellerId?: string
  sellerName: string
  paymentMethod: PaymentMethod
  customerPaid?: number
  changeAmount?: number
  totalQuantity: number
  totalAmount: number
  lines: SalesReceiptLine[]
  createdAt: string
  createdBy: string
  createdByName: string
}

export function loadLocalReceipts(): SalesReceipt[] {
  return []
}

export function saveLocalReceipts(receipts: SalesReceipt[]) {
  void receipts
}

const SALES_RECEIPT_PAGE_SIZE = 500

async function fetchAllSalesReceiptRows(
  loadPage: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += SALES_RECEIPT_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + SALES_RECEIPT_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data || []
    rows.push(...page)
    if (page.length < SALES_RECEIPT_PAGE_SIZE) return rows
  }
}

async function salesApi<T>(user: AppUser, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/sales-receipts${path}`, {
    ...init,
    headers: { ...userHeaders(user), ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Khong the xu ly hoa don POS.')
  return payload as T
}

export async function fetchSalesReceipts(
  user: AppUser,
  filters: { branchId: string; date: string },
): Promise<SalesReceipt[]> {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams({ branchId: filters.branchId, date: filters.date })
    return salesApi<SalesReceipt[]>(user, `?${query}`)
  }
  const rows = await fetchAllSalesReceiptRows((from, to) => supabase!
    .from('sales_receipts')
    .select('*, sales_receipt_items(*)')
    .eq('branch_id', filters.branchId)
    .eq('business_date', filters.date)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to))
  return rows.map(mapReceipt)
}

export async function fetchSalesReceiptsRange(
  user: AppUser,
  filters: { branchIds: string[]; from: string; to: string },
): Promise<SalesReceipt[]> {
  const branchIds = Array.from(new Set(filters.branchIds.filter(Boolean)))
  if (!branchIds.length) return []
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams({
      branchIds: branchIds.join(','),
      from: filters.from,
      to: filters.to,
    })
    return salesApi<SalesReceipt[]>(user, `/range?${query}`)
  }
  const rows = await fetchAllSalesReceiptRows((from, to) => supabase!
    .from('sales_receipts')
    .select('*, sales_receipt_items(*)')
    .in('branch_id', branchIds)
    .gte('business_date', filters.from)
    .lte('business_date', filters.to)
    .order('business_date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to))
  return rows.map(mapReceipt)
}

export async function saveSalesReceipt(user: AppUser, receipt: SalesReceipt): Promise<SalesReceipt> {
  if (shouldUseLanApi(user)) {
    await salesApi(user, '', { method: 'POST', body: JSON.stringify(receipt) })
    return receipt
  }
  const { data, error } = await supabase!.rpc('create_cashier_pos_receipt', {
    p_receipt: {
      id: receipt.id,
      branch_id: receipt.branchId,
      business_date: receipt.businessDate,
      seller_id: receipt.sellerId || null,
      seller_name: receipt.sellerName,
      payment_method: receipt.paymentMethod,
      customer_paid: receipt.customerPaid,
    },
    p_lines: receipt.lines.map((line) => ({
      allocation_id: line.allocationId || null,
      product_id: line.productId,
      product_name: line.productName,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_total: line.total,
    })),
  })
  if (error) throw new Error(error.message)
  return {
    ...receipt,
    id: data.id,
    code: data.code,
    customerPaid: Number(data.customer_paid),
    changeAmount: Number(data.change_amount),
    createdAt: data.created_at,
  }
}

export async function deleteSalesReceipt(user: AppUser, receipt: SalesReceipt): Promise<void> {
  if (shouldUseLanApi(user)) {
    await salesApi(user, `/${encodeURIComponent(receipt.id)}`, { method: 'DELETE' })
    return
  }
  const { error } = await supabase!.rpc('delete_pos_receipt', { p_receipt_id: receipt.id })
  if (error) throw new Error(error.message)
}

function mapReceipt(row: any): SalesReceipt {
  const lines = (row.sales_receipt_items || []).map((line: any) => ({
    allocationId: line.allocation_id || undefined,
    productId: line.product_id,
    productName: line.product_name,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unit_price),
    total: Number(line.line_total),
  }))
  const sellerId = row.seller_id || undefined
  return {
    id: row.id,
    code: row.code,
    branchId: row.branch_id,
    businessDate: row.business_date,
    sellerKey: sellerId || normalizeName(row.seller_name),
    sellerId,
    sellerName: row.seller_name,
    paymentMethod: row.payment_method,
    customerPaid: row.customer_paid === null || row.customer_paid === undefined ? undefined : Number(row.customer_paid),
    changeAmount: Number(row.change_amount || 0),
    totalQuantity: Number(row.total_quantity),
    totalAmount: Number(row.total_amount),
    lines,
    createdAt: row.created_at,
    createdBy: row.created_by,
    createdByName: '',
  }
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
