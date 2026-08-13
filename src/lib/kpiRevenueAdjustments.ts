import { isMissingTable } from './core'
import { shouldUseLanApi, supabase } from './supabase'
import type { SalesReceipt } from './salesReceipts'
import type { AppUser } from '../types'

export interface KpiRevenueAdjustment {
  id: string
  sourceKey: string
  branchId: string
  employeeId: string
  businessDate: string
  amount: number
  reason: string
  createdAt: string
}

export async function fetchKpiRevenueAdjustments(
  user: AppUser,
  filters: { branchIds: string[]; from: string; to: string },
): Promise<KpiRevenueAdjustment[]> {
  if (shouldUseLanApi(user) || !supabase) return []
  const branchIds = Array.from(new Set(filters.branchIds.filter(Boolean)))
  if (!branchIds.length) return []
  const { data, error } = await supabase
    .from('employee_kpi_revenue_adjustments')
    .select('id, source_key, branch_id, employee_id, business_date, amount, reason, created_at')
    .in('branch_id', branchIds)
    .gte('business_date', filters.from)
    .lte('business_date', filters.to)
    .order('business_date', { ascending: true })
    .order('source_key', { ascending: true })
  if (error) {
    // Cho phép frontend cũ chạy trong khoảng ngắn trước khi migration được apply;
    // sau migration mọi lỗi khác vẫn phải lộ ra, không được giả vờ dữ liệu bằng 0.
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    sourceKey: row.source_key,
    branchId: row.branch_id,
    employeeId: row.employee_id,
    businessDate: row.business_date,
    amount: Number(row.amount || 0),
    reason: row.reason || '',
    createdAt: row.created_at,
  }))
}

/**
 * Adapter chỉ dùng bên trong bộ tính KPI. Không ghi vào `sales_receipts`, không
 * xuất kho và không xuất hiện trong lịch sử hóa đơn POS.
 */
export function kpiRevenueAdjustmentReceipt(
  adjustment: KpiRevenueAdjustment,
  employeeName: string,
): SalesReceipt {
  return {
    id: `kpi-adjustment:${adjustment.id}`,
    code: `KPIBS-${adjustment.sourceKey}`,
    branchId: adjustment.branchId,
    businessDate: adjustment.businessDate,
    sellerKey: adjustment.employeeId,
    sellerId: adjustment.employeeId,
    sellerName: employeeName,
    totalQuantity: 0,
    totalAmount: adjustment.amount,
    lines: [{
      productId: 'kpi-historical-revenue',
      productName: 'Bổ sung KPI lịch sử',
      quantity: 0,
      unitPrice: 0,
      total: adjustment.amount,
    }],
    createdAt: adjustment.createdAt || `${adjustment.businessDate}T12:00:00+07:00`,
    createdBy: '',
    createdByName: 'Bổ sung theo xác nhận của chủ hệ thống',
  }
}
