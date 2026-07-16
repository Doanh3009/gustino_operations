import { supabase } from './supabase'
import { userHeaders } from './core'
import type { AppUser } from '../types'

export type ZaloReportKind = 'shift-1' | 'shift-2' | 'day'

export async function sendZaloShiftReports(
  user: AppUser,
  input: {
    branchId: string
    branchName: string
    businessDate: string
    shiftId: string
    shiftSequence: 1 | 2
    reportKinds: ZaloReportKind[]
    reports: Array<{
      kind: ZaloReportKind
      label: string
      revenue: number
      sold: number
      employeeCount: number
      imageDataUrl?: string
    }>
  },
) {
  const accessToken = user.authToken
    || (supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined)
  if (!accessToken) return { sent: false, message: 'Phiên đăng nhập chưa có token để xác thực gửi Zalo.' }
  const response = await fetch('/api/zalo-shift-report', {
    method: 'POST',
    headers: { ...userHeaders(user), Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ...input, leaderId: user.id, leaderName: user.name }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    return { sent: false, message: payload?.error || 'Không thể gửi báo cáo vào Zalo.' }
  }
  return {
    sent: true,
    message: payload?.warning || `Đã gửi ${payload?.sentCount || input.reports.length} báo cáo vào nhóm Zalo.`,
    messageIds: payload?.messageIds || [],
    mode: payload?.mode || 'text',
  }
}
