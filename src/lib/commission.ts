import { supabase } from './supabase'
import type { AppUser, BagAllocation, CommissionRule } from '../types'

export const COMMISSION_MIN_BAGS = 15

const PRODUCT_PRICES: Record<string, number> = {
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

export function commissionPerBag(price: number) {
  if (price < 50000) return 1000
  if (price < 100000) return 2000
  return 3000
}

export function productSaleValues(productId: string, quantity: number) {
  const price = PRODUCT_PRICES[productId] || 0
  return {
    price,
    revenue: Math.round(quantity * price),
    commissionBase: Math.round(quantity * commissionPerBag(price)),
  }
}

export function soldBagQuantity(allocation: BagAllocation) {
  if (typeof allocation.soldQuantity === 'number') return Math.max(0, allocation.soldQuantity)
  return allocation.settledAt
    ? Math.max(0, allocation.issuedQuantity - allocation.returnedQuantity - allocation.damagedQuantity)
    : 0
}

export function summarizeEmployeeBagSales(allocations: BagAllocation[]) {
  const rows = new Map<string, {
    employeeKey: string
    employeeId?: string
    employeeName: string
    branchId: string
    soldQuantity: number
    revenue: number
    commissionBase: number
  }>()
  allocations.filter((item) => item.settledAt).forEach((allocation) => {
    const employeeKey = allocation.employeeId || normalizeName(allocation.employeeName)
    const key = `${allocation.branchId}|${employeeKey}`
    const current = rows.get(key) || {
      employeeKey,
      employeeId: allocation.employeeId,
      employeeName: allocation.employeeName,
      branchId: allocation.branchId,
      soldQuantity: 0,
      revenue: 0,
      commissionBase: 0,
    }
    const soldQuantity = soldBagQuantity(allocation)
    const values = productSaleValues(allocation.productId, soldQuantity)
    current.soldQuantity += soldQuantity
    current.revenue += values.revenue
    current.commissionBase += values.commissionBase
    rows.set(key, current)
  })
  return Array.from(rows.values()).map((row) => ({
    ...row,
    achieved: row.soldQuantity >= COMMISSION_MIN_BAGS,
    commission: row.soldQuantity >= COMMISSION_MIN_BAGS ? row.commissionBase : 0,
  }))
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

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

export async function fetchCommissionRules(user: AppUser): Promise<CommissionRule[]> {
  if (!supabase) {
    const response = await fetch('/api/commission-rules', { headers: authHeaders(user) })
    if (!response.ok) throw new Error('Không thể tải chính sách hoa hồng.')
    return response.json()
  }
  const { data, error } = await supabase.from('commission_rules').select('*')
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    targetQuantity: Number(row.target_quantity),
    commissionPerUnit: Number(row.commission_per_unit),
    updatedAt: row.updated_at,
  }))
}

export async function saveCommissionRule(
  user: AppUser,
  input: Pick<CommissionRule, 'branchId' | 'targetQuantity' | 'commissionPerUnit'>,
) {
  if (user.role !== 'manager') throw new Error('Chỉ Quản lý được đổi chính sách hoa hồng.')
  if (!supabase) {
    const response = await fetch('/api/commission-rules', {
      method: 'PUT',
      headers: authHeaders(user),
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không thể lưu chính sách hoa hồng.')
    return response.json() as Promise<CommissionRule>
  }
  const { data, error } = await supabase.from('commission_rules').upsert({
    branch_id: input.branchId,
    target_quantity: input.targetQuantity,
    commission_per_unit: input.commissionPerUnit,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'branch_id' }).select().single()
  if (error) throw error
  return {
    id: data.id,
    branchId: data.branch_id,
    targetQuantity: Number(data.target_quantity),
    commissionPerUnit: Number(data.commission_per_unit),
    updatedAt: data.updated_at,
  } satisfies CommissionRule
}
