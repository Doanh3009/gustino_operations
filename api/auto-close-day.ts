declare const process: { env: Record<string, string | undefined> }

interface OpenOperationDay {
  id: string
  branch_id: string
  business_date: string
  opened_by: string
}

interface BagShiftRow {
  id: string
  leader_id: string
  leader_name?: string | null
  sequence: number
  status: 'open' | 'closed'
  discrepancy_note?: string | null
  opening_photo_url?: string | null
  closing_photo_url?: string | null
  started_at?: string | null
  ended_at?: string | null
}

interface BagAllocationRow {
  id: string
  shift_id: string
  issued_quantity: number | string
  sold_quantity?: number | string | null
  damaged_quantity?: number | string | null
}

interface ReportSnapshotRow {
  payload?: Record<string, unknown> | null
}

interface SalesReceiptRow {
  id: string
  seller_id?: string | null
  seller_name?: string | null
  total_quantity?: number | string | null
  total_amount?: number | string | null
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'GET') return response.status(405).json({ ok: false, error: 'Method not allowed.' })

  const cronSecret = process.env.CRON_SECRET
  const authorization = Array.isArray(request.headers?.authorization)
    ? request.headers.authorization[0]
    : request.headers?.authorization
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return response.status(401).json({ ok: false, error: 'Unauthorized.' })
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceRoleKey) {
    return response.status(503).json({
      ok: false,
      error: 'Auto-close chưa được cấu hình SUPABASE_SERVICE_ROLE_KEY/SUPABASE_URL trên máy chủ.',
    })
  }

  const client = createServiceClient(supabaseUrl, serviceRoleKey)
  const checkedAt = new Date()
  const cutoffBusinessDate = previousBusinessDateInTimeZone(checkedAt, 'Asia/Bangkok')
  try {
    const days = await client.get<OpenOperationDay[]>(
      `/rest/v1/operation_days?status=eq.open&business_date=lte.${encodeURIComponent(cutoffBusinessDate)}`
      + '&select=id,branch_id,business_date,opened_by&order=business_date.asc&limit=100',
    )
    const results = []
    for (const day of days) {
      results.push(await closeOperationDay(client, day))
    }
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json({
      ok: true,
      checkedAt: checkedAt.toISOString(),
      throughBusinessDate: cutoffBusinessDate,
      closed: results,
    })
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Không thể tự đóng ngày vận hành.',
    })
  }
}

async function closeOperationDay(client: ReturnType<typeof createServiceClient>, day: OpenOperationDay) {
  const branch = encodeURIComponent(day.branch_id)
  const businessDate = encodeURIComponent(day.business_date)
  const sessions = await client.get<BagShiftRow[]>(
    `/rest/v1/bag_shift_sessions?branch_id=eq.${branch}&business_date=eq.${businessDate}`
    + '&select=id,leader_id,leader_name,sequence,status,discrepancy_note,opening_photo_url,closing_photo_url,started_at,ended_at&order=sequence.desc',
  )
  const actorId = sessions[0]?.leader_id || day.opened_by
  if (!actorId) throw new Error(`Ngày ${day.business_date} tại ${day.branch_id} không có người chịu trách nhiệm để chốt.`)

  const endedAt = new Date().toISOString()
  const shiftIds = sessions.map((item) => item.id)
  let settledAllocationCount = 0
  if (shiftIds.length) {
    const allocations = await client.get<BagAllocationRow[]>(
      `/rest/v1/bag_allocations?shift_id=in.(${shiftIds.map(encodeURIComponent).join(',')})&settled_at=is.null`
      + '&select=id,shift_id,issued_quantity,sold_quantity,damaged_quantity',
    )
    settledAllocationCount = allocations.length
    await inBatches(allocations, 12, async (allocation) => {
      const returnedQuantity = Math.max(
        0,
        numberValue(allocation.issued_quantity)
          - numberValue(allocation.sold_quantity)
          - numberValue(allocation.damaged_quantity),
      )
      await client.patch(`/rest/v1/bag_allocations?id=eq.${encodeURIComponent(allocation.id)}`, {
        returned_quantity: returnedQuantity,
        settled_by: actorId,
        settlement_shift_id: allocation.shift_id,
        settled_at: endedAt,
      })
    })
  }

  const openSessions = sessions.filter((item) => item.status === 'open')
  await inBatches(openSessions, 12, async (session) => {
    await client.patch(`/rest/v1/bag_shift_sessions?id=eq.${encodeURIComponent(session.id)}&status=eq.open`, {
      status: 'closed',
      discrepancy_note: session.discrepancy_note || 'Auto closed by daily report.',
      ended_at: endedAt,
    })
  })

  const snapshots = await client.get<ReportSnapshotRow[]>(
    `/rest/v1/report_snapshots?branch_id=eq.${branch}&report_date=eq.${businessDate}&select=payload&limit=1`,
  )
  const previousPayload = snapshots[0]?.payload && typeof snapshots[0].payload === 'object'
    ? snapshots[0].payload
    : {}
  const completedDayPayload = await buildCompletedDayPayload(client, day, sessions, previousPayload, endedAt)
  await client.post('/rest/v1/report_snapshots?on_conflict=branch_id,report_date', {
    id: crypto.randomUUID(),
    branch_id: day.branch_id,
    report_date: day.business_date,
    created_by: actorId,
    payload: {
      ...completedDayPayload,
      reportDate: day.business_date,
      finalizedBy: actorId,
      finalizedByName: 'Hệ thống tự động',
      finalizedAt: endedAt,
      autoFinalizedAt: endedAt,
    },
  }, 'resolution=merge-duplicates,return=minimal')

  // Khóa ngày sau cùng để một lỗi giữa chừng không tạo trạng thái "đã đóng" giả.
  await client.patch(`/rest/v1/operation_days?id=eq.${encodeURIComponent(day.id)}&status=eq.open`, {
    status: 'closed',
    closed_by: actorId,
    closed_at: endedAt,
  })
  return {
    branchId: day.branch_id,
    businessDate: day.business_date,
    settledAllocations: settledAllocationCount,
    closedSessions: openSessions.length,
  }
}

async function buildCompletedDayPayload(
  client: ReturnType<typeof createServiceClient>,
  day: OpenOperationDay,
  sessions: BagShiftRow[],
  previousPayload: Record<string, unknown>,
  endedAt: string,
) {
  const branch = encodeURIComponent(day.branch_id)
  const businessDate = encodeURIComponent(day.business_date)
  const receipts = await client.get<SalesReceiptRow[]>(
    `/rest/v1/sales_receipts?branch_id=eq.${branch}&business_date=eq.${businessDate}`
    + '&select=id,seller_id,seller_name,total_quantity,total_amount&order=created_at.asc,id.asc',
  )
  const revenue = receipts.reduce((sum, item) => sum + numberValue(item.total_amount), 0)
  const totalSold = receipts.reduce((sum, item) => sum + numberValue(item.total_quantity), 0)
  const employeeMap = new Map<string, { key: string; name: string; sold: number; revenue: number; kpi: number }>()
  for (const receipt of receipts) {
    const name = receipt.seller_name?.trim() || 'Nhân viên bán hàng'
    const key = receipt.seller_id || normalizeKey(name)
    const current = employeeMap.get(key) || { key, name, sold: 0, revenue: 0, kpi: 0 }
    current.sold += numberValue(receipt.total_quantity)
    current.revenue += numberValue(receipt.total_amount)
    employeeMap.set(key, current)
  }
  const leaders = Array.from(new Set(sessions.map((item) => item.leader_name?.trim()).filter(Boolean))) as string[]
  const priorSummary = recordValue(previousPayload.summary)
  const priorDailyReport = recordValue(previousPayload.dailyReport)
  const priorTotals = recordValue(priorDailyReport.totals)
  const proofImages = [...sessions]
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((session) => [
      {
        key: `${session.id}-opening`,
        label: `Ca ${session.sequence} · Đầu ca`,
        url: session.opening_photo_url || '',
      },
      {
        key: `${session.id}-closing`,
        label: `Ca ${session.sequence} · Cuối ca`,
        url: session.closing_photo_url || '',
      },
    ])

  return {
    ...previousPayload,
    summary: {
      ...priorSummary,
      revenue,
      totalSold,
      shiftTime: formatBusinessDate(day.business_date),
      leader: leaders.join(', ') || 'Hệ thống tự động',
    },
    dailyReport: {
      ...priorDailyReport,
      branchName: String(priorDailyReport.branchName || day.branch_id),
      businessDate: day.business_date,
      dateLabel: formatBusinessDate(day.business_date),
      leaderNames: leaders,
      closedShiftCount: sessions.length,
      openShiftCount: 0,
      employeeRows: Array.from(employeeMap.values()).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, 'vi')),
      proofImages,
      totals: {
        ...priorTotals,
        sold: totalSold,
        revenue,
      },
      autoFinalizedAt: endedAt,
    },
  }
}

function createServiceClient(baseUrl: string, serviceRoleKey: string) {
  const baseHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
  async function request<T>(path: string, init: RequestInit = {}) {
    const result = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...baseHeaders, ...(init.headers || {}) },
    })
    if (!result.ok) {
      const detail = (await result.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
      throw new Error(`Supabase auto-close lỗi HTTP ${result.status}${detail ? `: ${detail}` : '.'}`)
    }
    if (result.status === 204) return undefined as T
    const body = await result.text()
    return (body ? JSON.parse(body) : undefined) as T
  }
  return {
    get: <T>(path: string) => request<T>(path),
    patch: (path: string, body: Record<string, unknown>) => request<void>(path, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }),
    post: (path: string, body: Record<string, unknown>, prefer = 'return=minimal') => request<void>(path, {
      method: 'POST',
      headers: { Prefer: prefer },
      body: JSON.stringify(body),
    }),
  }
}

async function inBatches<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(task))
  }
}

function numberValue(value: number | string | null | undefined) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function normalizeKey(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function formatBusinessDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function dateKeyInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

export function previousBusinessDateInTimeZone(value: Date, timeZone: string) {
  const currentDate = dateKeyInTimeZone(value, timeZone)
  const [year, month, day] = currentDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}
