export type ReportDeliveryKind = 'shift-1' | 'shift-2' | 'day'

export interface ZaloReportIntent {
  channel: 'zalo'
  status: 'pending_connection'
  trigger: 'report_finalized'
  reportKinds: ReportDeliveryKind[]
  branchId: string
  businessDate: string
  shiftId: string
  shiftSequence: 1 | 2
  requestedBy: string
  requestedByName: string
  requestedAt: string
}

export function reportKindsForShiftSequence(sequence: 1 | 2): ReportDeliveryKind[] {
  return sequence === 1 ? ['shift-1'] : ['shift-2', 'day']
}

export function createZaloReportIntent(input: {
  branchId: string
  businessDate: string
  shiftId: string
  shiftSequence: 1 | 2
  requestedBy: string
  requestedByName: string
  requestedAt?: string
}): ZaloReportIntent {
  return {
    channel: 'zalo',
    status: 'pending_connection',
    trigger: 'report_finalized',
    reportKinds: reportKindsForShiftSequence(input.shiftSequence),
    branchId: input.branchId,
    businessDate: input.businessDate,
    shiftId: input.shiftId,
    shiftSequence: input.shiftSequence,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    requestedAt: input.requestedAt || new Date().toISOString(),
  }
}
