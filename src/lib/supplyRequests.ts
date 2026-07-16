import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser } from '../types'

export type SupplyRequestStatus = 'pending' | 'acknowledged' | 'fulfilled' | 'cancelled'

export interface SupplyRequest {
  id: string
  branchId: string
  productName: string
  quantity: number
  unit: string
  note: string
  requestedBy?: string
  requestedByName: string
  status: SupplyRequestStatus
  createdAt: string
  updatedAt?: string
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

async function supplyApi<T>(user: AppUser, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/supply-requests${path}`, {
    ...init,
    headers: { ...authHeaders(user), ...(init?.headers || {}) },
  })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('May chu dat bep chua hoat dong. Hay khoi dong lai ung dung.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Không thể xử lý yêu cầu đặt bếp.')
  }
  return response.json() as Promise<T>
}

function mapSupplyRequest(row: any): SupplyRequest {
  return {
    id: row.id,
    branchId: row.branch_id ?? row.branchId,
    productName: row.product_name ?? row.productName,
    quantity: Number(row.quantity),
    unit: row.unit,
    note: row.note || '',
    requestedBy: row.requested_by ?? row.requestedBy,
    requestedByName: row.requested_by_name ?? row.requestedByName,
    status: row.status,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  }
}

const SUPPLY_REQUEST_PAGE_SIZE = 500

async function fetchAllSupplyRequestRows(
  loadPage: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += SUPPLY_REQUEST_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + SUPPLY_REQUEST_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data || []
    rows.push(...page)
    if (page.length < SUPPLY_REQUEST_PAGE_SIZE) return rows
  }
}

export async function createSupplyRequest(
  user: AppUser,
  data: { productName: string; quantity: number; unit: string; note: string },
) {
  if (shouldUseLanApi(user)) {
    await supplyApi<SupplyRequest>(user, '', {
      method: 'POST',
      body: JSON.stringify({
        branchId: user.branchId,
        productName: data.productName,
        quantity: data.quantity,
        unit: data.unit,
        note: data.note,
        requestedByName: user.name,
      }),
    })
    return
  }
  const { error } = await supabase!.from('supply_requests').insert({
    branch_id: user.branchId,
    product_name: data.productName,
    quantity: data.quantity,
    unit: data.unit,
    note: data.note,
    requested_by: user.id,
    requested_by_name: user.name,
    status: 'pending',
  })
  if (error) throw new Error(error.message)
}
export async function createSupplyRequests(
  user: AppUser,
  lines: Array<{ productName: string; quantity: number; unit: string; note: string }>,
) {
  const validLines = lines.filter((line) => line.productName.trim() && Number(line.quantity) > 0)
  if (!validLines.length) throw new Error('Chưa có món hợp lệ để gửi bếp.')
  if (shouldUseLanApi(user)) {
    await supplyApi<SupplyRequest[]>(user, '', {
      method: 'POST',
      body: JSON.stringify({
        branchId: user.branchId,
        requestedByName: user.name,
        items: validLines,
      }),
    })
    return
  }
  const { error } = await supabase!.from('supply_requests').insert(validLines.map((line) => ({
    branch_id: user.branchId,
    product_name: line.productName,
    quantity: line.quantity,
    unit: line.unit,
    note: line.note,
    requested_by: user.id,
    requested_by_name: user.name,
    status: 'pending',
  })))
  if (error) throw new Error(error.message)
}
export async function fetchSupplyRequests(user: AppUser, branchIds: string[]): Promise<SupplyRequest[]> {
  const authorizedBranchIds = Array.from(new Set(branchIds.filter(Boolean)))
  if (!authorizedBranchIds.length) return []
  if (shouldUseLanApi(user)) {
    const params = new URLSearchParams()
    params.set('branchIds', authorizedBranchIds.join(','))
    return supplyApi<SupplyRequest[]>(user, `?${params.toString()}`)
  }
  const rows = await fetchAllSupplyRequestRows((from, to) => supabase!
    .from('supply_requests')
    .select('*')
    .in('branch_id', authorizedBranchIds)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to))
  return rows.map(mapSupplyRequest)
}

export async function updateSupplyRequestStatus(
  user: AppUser,
  requestId: string,
  status: SupplyRequestStatus,
): Promise<void> {
  if (shouldUseLanApi(user)) {
    await supplyApi<SupplyRequest>(user, `/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    return
  }
  const { error } = await supabase!
    .from('supply_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', requestId)
  if (error) throw new Error(error.message)
}

export async function acknowledgeSupplyRequest(user: AppUser, requestId: string): Promise<void> {
  await updateSupplyRequestStatus(user, requestId, 'acknowledged')
}

export async function updateSupplyRequest(
  user: AppUser,
  requestId: string,
  patch: Partial<Pick<SupplyRequest, 'productName' | 'quantity' | 'unit' | 'note' | 'status'>>,
): Promise<void> {
  if (shouldUseLanApi(user)) {
    await supplyApi<SupplyRequest>(user, `/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return
  }
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.productName !== undefined) row.product_name = patch.productName
  if (patch.quantity !== undefined) row.quantity = patch.quantity
  if (patch.unit !== undefined) row.unit = patch.unit
  if (patch.note !== undefined) row.note = patch.note
  if (patch.status !== undefined) row.status = patch.status
  const { error } = await supabase!
    .from('supply_requests')
    .update(row)
    .eq('id', requestId)
  if (error) throw new Error(error.message)
}

export async function deleteSupplyRequest(user: AppUser, requestId: string): Promise<void> {
  if (shouldUseLanApi(user)) {
    await supplyApi<{ ok: true }>(user, `/${requestId}`, { method: 'DELETE' })
    return
  }
  const { error } = await supabase!
    .from('supply_requests')
    .delete()
    .eq('id', requestId)
  if (error) throw new Error(error.message)
}
