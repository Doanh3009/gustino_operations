import { supabase } from './supabase'
import { userHeaders } from './core'
import type { AppUser } from '../types'

export type N8nReportKind = 'shift-1' | 'shift-2' | 'day'
const N8N_API_TIMEOUT_MS = 25_000

export interface N8nReportImage {
  kind: N8nReportKind
  label: string
  fileName: string
  mimeType: 'image/jpeg'
  imageBase64: string
}

interface QueueInput {
  branchId: string
  branchName: string
  businessDate: string
  shiftId: string
  shiftSequence: 1 | 2
  sendNow?: boolean
  reports: N8nReportImage[]
}

export interface N8nQueueResult {
  queued: boolean
  mode: 'n8n' | 'disabled' | 'not-configured' | 'error'
  message: string
  jobs: Record<string, Record<string, unknown>>
}

interface N8nQueueResponsePayload {
  code?: string
  error?: string
  message?: string
  mode?: string
  job?: Record<string, unknown>
}

function localApiFailureMessage(status: number) {
  const httpStatus = `HTTP ${status}`
  if (status === 413) {
    return `Ảnh báo cáo vượt giới hạn của API n8n local (${httpStatus}). Hãy tải lại trang rồi thử lại.`
  }
  if (status >= 500) {
    return `API n8n local không phản hồi đúng (${httpStatus}). Hãy chạy lại npm run dev rồi bấm Gửi Zalo.`
  }
  return `Hàng đợi n8n trả lỗi ${httpStatus}. Hãy tải lại trang, đăng nhập lại nếu cần rồi thử lại.`
}

export async function queueN8nReportImages(user: AppUser, input: QueueInput): Promise<N8nQueueResult> {
  const accessToken = user.authToken
    || (supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined)
  if (!accessToken) {
    return { queued: false, mode: 'error', message: 'Phiên đăng nhập chưa có token để xác thực hàng đợi n8n.', jobs: {} }
  }

  const jobs: Record<string, Record<string, unknown>> = {}
let isFirst = true
for (const report of input.reports) {
  if (!isFirst) await new Promise((resolve) => setTimeout(resolve, 3000))
  isFirst = false
    let response: Response
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), N8N_API_TIMEOUT_MS)
    try {
      response = await fetch('/api/n8n-report-image', {
        method: 'POST',
        headers: { ...userHeaders(user), Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
        body: JSON.stringify({
          ...input,
          reports: undefined,
          report,
          leaderId: user.id,
          leaderName: user.name,
        }),
      })
    } catch (error) {
      return {
        queued: false,
        mode: 'error',
        message: error instanceof DOMException && error.name === 'AbortError'
          ? 'n8n quá thời gian chờ. Hãy kiểm tra workflow đang Active rồi bấm Gửi Zalo.'
          : 'Không kết nối được máy chủ để đưa ảnh vào hàng đợi n8n.',
        jobs,
      }
    } finally {
      window.clearTimeout(timeout)
    }

    const responseText = await response.text()
    let payload: N8nQueueResponsePayload | null = null
    if (responseText) {
      try {
        payload = JSON.parse(responseText) as N8nQueueResponsePayload
      } catch {
        payload = null
      }
    }
    if (!response.ok) {
      const mode = payload?.code === 'N8N_NOT_CONFIGURED' ? 'not-configured' : 'error'
      return {
        queued: false,
        mode,
        message: payload?.error || localApiFailureMessage(response.status),
        jobs,
      }
    }
    if (!payload) {
      return {
        queued: false,
        mode: 'error',
        message: `API n8n local trả dữ liệu không hợp lệ (HTTP ${response.status}). Hãy chạy lại npm run dev rồi thử lại.`,
        jobs,
      }
    }
    if (payload?.mode === 'disabled') {
      return {
        queued: false,
        mode: 'disabled',
        message: payload?.message || 'n8n đang tắt để kiểm thử an toàn.',
        jobs,
      }
    }
    if (payload?.job) jobs[report.kind] = payload.job
  }

  const queued = input.reports.every((report) => jobs[report.kind]?.queued === true)
  return {
    queued,
    mode: queued ? 'n8n' : 'error',
    message: queued
      ? input.sendNow
        ? `Đã yêu cầu n8n gửi ngay ${input.reports.length} ảnh Zalo.`
        : `Đã đưa ${input.reports.length} ảnh vào lịch gửi tự động n8n.`
      : 'Một phần ảnh chưa vào được hàng đợi n8n. Có thể bấm Gửi Zalo.',
    jobs,
  }
}
