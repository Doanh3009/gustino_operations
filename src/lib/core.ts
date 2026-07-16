import type { AppUser, BagAllocation, BagShiftSession } from '../types'

export function userHeaders(user: AppUser) {
  return {
    'Content-Type': 'application/json',
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
    'X-User-Id': user.id,
    'X-User-Role': user.role,
    'X-User-Branch': user.branchId,
    'X-User-Branches': userBranchIds(user).join(','),
  }
}

export function userBranchIds(user?: Pick<AppUser, 'branchId' | 'branchIds'> | null) {
  if (!user) return []
  return Array.from(new Set([user.branchId, ...(user.branchIds || [])].filter(Boolean)))
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  options: { basePath?: string; user?: AppUser; defaultError?: string } = {},
): Promise<T> {
  const basePath = options.basePath || '/api'
  const response = await fetch(`${basePath}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(options.user ? userHeaders(options.user) : {}),
      ...(init.headers || {}),
    },
  })
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null
  if (!response.ok) {
    throw new Error(payload?.error || options.defaultError || 'Không thể đồng bộ dữ liệu với máy chủ.')
  }
  if (!contentType.includes('application/json')) {
    throw new Error(options.defaultError || 'Máy chủ trả về dữ liệu không hợp lệ.')
  }
  return payload as T
}

export function isMissingRpc(error: unknown, functionName: string) {
  const err = error as { message?: string; code?: string } | null
  const message = String(err?.message || '')
  const code = String(err?.code || '')
  return code === 'PGRST202'
    || message.includes(functionName)
    || message.includes('Could not find the function')
    || message.includes('schema cache')
    || message.includes('404')
}

export function isMissingUniqueConstraint(error: unknown) {
  const err = error as { message?: string; code?: string } | null
  const message = String(err?.message || '')
  return String(err?.code || '') === '42P10'
    || message.includes('no unique or exclusion constraint')
    || message.includes('there is no unique')
}

export function isDuplicateKey(error: unknown) {
  const err = error as { message?: string; code?: string } | null
  return String(err?.code || '') === '23505'
    || String(err?.message || '').includes('duplicate key')
}

export function isMissingTable(error: unknown) {
  const err = error as { message?: string; code?: string } | null
  const message = String(err?.message || '')
  const code = String(err?.code || '')
  return code === '42P01'
    || code === 'PGRST205'
    || code === 'PGRST204'
    || message.includes('does not exist')
    || message.includes('Could not find the table')
    || message.includes('schema cache')
}

export function mapBagShiftSession(row: any): BagShiftSession {
  return {
    id: row.id,
    branchId: row.branch_id,
    businessDate: row.business_date,
    sequence: row.sequence,
    leaderId: row.leader_id,
    leaderName: row.leader_name,
    status: row.status,
    openingBalances: numberMap(row.opening_balances),
    closingBalances: row.closing_balances ? numberMap(row.closing_balances) : undefined,
    discrepancyNote: row.discrepancy_note || undefined,
    openingPhotoUrl: row.opening_photo_url || undefined,
    closingPhotoUrl: row.closing_photo_url || undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at || undefined,
  }
}

export function mapBagAllocation(row: any): BagAllocation {
  return {
    id: row.id,
    branchId: row.branch_id,
    shiftId: row.shift_id,
    businessDate: row.business_date || row.bag_shift_sessions?.business_date || undefined,
    employeeName: row.employee_name,
    employeeId: row.employee_id || undefined,
    productId: row.product_id,
    issuedQuantity: Number(row.issued_quantity),
    soldQuantity: row.sold_quantity === null || row.sold_quantity === undefined ? undefined : Number(row.sold_quantity || 0),
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

export function numberMap(value: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, quantity]) => [key, Number(quantity) || 0]))
}
