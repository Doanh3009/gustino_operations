import { readLocalJson } from './browser'
import { supabase } from './supabase'
import type { AppUser } from '../types'

const RECEIPT_KEY = 'gustino_pos_receipts_v1'

export type PaymentMethod = 'cash' | 'qr' | 'card'

export interface SalesReceiptLine {
  allocationId: string
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
  totalQuantity: number
  totalAmount: number
  lines: SalesReceiptLine[]
  createdAt: string
  createdBy: string
  createdByName: string
}

export function loadLocalReceipts(): SalesReceipt[] {
  return readLocalJson<SalesReceipt[]>(RECEIPT_KEY, [])
}

export function saveLocalReceipts(receipts: SalesReceipt[]) {
  localStorage.setItem(RECEIPT_KEY, JSON.stringify(receipts))
}

export async function fetchSalesReceipts(
  user: AppUser,
  filters: { branchId: string; date: string },
): Promise<SalesReceipt[]> {
  if (!supabase) {
    return loadLocalReceipts().filter((receipt) =>
      receipt.branchId === filters.branchId && receipt.createdAt.slice(0, 10) === filters.date,
    )
  }
  const { data, error } = await supabase
    .from('sales_receipts')
    .select('*, sales_receipt_items(*)')
    .eq('branch_id', filters.branchId)
    .eq('business_date', filters.date)
    .order('created_at', { ascending: false })
    .limit(120)
  if (error) throw new Error(error.message)
  return (data || []).map(mapReceipt)
}

export async function saveSalesReceipt(user: AppUser, receipt: SalesReceipt): Promise<void> {
  if (!supabase) {
    saveLocalReceipts([receipt, ...loadLocalReceipts()].slice(0, 200))
    return
  }
  const { error: receiptError } = await supabase.from('sales_receipts').insert({
    id: receipt.id,
    code: receipt.code,
    branch_id: receipt.branchId,
    business_date: receipt.businessDate,
    seller_id: receipt.sellerId || null,
    seller_name: receipt.sellerName,
    payment_method: receipt.paymentMethod,
    total_quantity: receipt.totalQuantity,
    total_amount: receipt.totalAmount,
    created_by: user.id,
    created_at: receipt.createdAt,
  })
  if (receiptError) throw new Error(receiptError.message)
  const { error: itemError } = await supabase.from('sales_receipt_items').insert(receipt.lines.map((line) => ({
    receipt_id: receipt.id,
    allocation_id: line.allocationId,
    product_id: line.productId,
    product_name: line.productName,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    line_total: line.total,
    created_at: receipt.createdAt,
  })))
  if (itemError) throw new Error(itemError.message)
}

function mapReceipt(row: any): SalesReceipt {
  const lines = (row.sales_receipt_items || []).map((line: any) => ({
    allocationId: line.allocation_id,
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
