import { supabase } from './supabase'
import { userHeaders } from './core'
import type { AppUser } from '../types'

export type N8nReportKind = 'shift-1' | 'shift-2' | 'day'
const N8N_API_TIMEOUT_MS = 25_000
/** Khoảng nghỉ giữa hai lượt gửi ảnh (main@7f4e914). */
const N8N_REPORT_GAP_MS = 3_000

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
  /** Chỉ nút "Gửi Zalo" thủ công (người dùng đã xác nhận gửi trùng) mới đặt true. */
  force?: boolean
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

type SingleReportOutcome =
  | { ok: true; job: Record<string, unknown> }
  | { ok: false; fatalMode?: 'disabled' | 'not-configured'; message: string }

async function postSingleReport(
  user: AppUser,
  input: QueueInput,
  report: N8nReportImage,
  accessToken: string,
): Promise<SingleReportOutcome> {
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
      ok: false,
      message: error instanceof DOMException && error.name === 'AbortError'
        ? 'n8n quá thời gian chờ. Hãy kiểm tra workflow đang Active rồi bấm Gửi Zalo.'
        : 'Không kết nối được máy chủ để đưa ảnh vào hàng đợi n8n.',
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
    if (payload?.code === 'N8N_NOT_CONFIGURED') {
      return { ok: false, fatalMode: 'not-configured', message: payload?.error || 'Chưa cấu hình webhook n8n.' }
    }
    return { ok: false, message: payload?.error || localApiFailureMessage(response.status) }
  }
  if (!payload) {
    return { ok: false, message: `API n8n local trả dữ liệu không hợp lệ (HTTP ${response.status}). Hãy chạy lại npm run dev rồi thử lại.` }
  }
  if (payload.mode === 'disabled') {
    return { ok: false, fatalMode: 'disabled', message: payload.message || 'n8n đang tắt để kiểm thử an toàn.' }
  }
  if (payload.job) return { ok: true, job: payload.job }
  return { ok: false, message: payload.message || 'n8n không trả thông tin hàng đợi cho ảnh này.' }
}

/**
 * Gửi TỪNG ảnh độc lập: ảnh trước lỗi KHÔNG được làm mất ảnh sau (trước đây
 * return sớm nên ảnh "Tổng ngày" — luôn đứng thứ 2 — là ảnh bị rơi). Mỗi ảnh
 * được thử tối đa 2 lần; chống gửi trùng nằm ở server (job đã queued thì trả
 * idempotent trừ khi force=true).
 */
export async function queueN8nReportImages(user: AppUser, input: QueueInput): Promise<N8nQueueResult> {
  const accessToken = user.authToken
    || (supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined)
  if (!accessToken) {
    return { queued: false, mode: 'error', message: 'Phiên đăng nhập chưa có token để xác thực hàng đợi n8n.', jobs: {} }
  }

  const jobs: Record<string, Record<string, unknown>> = {}
  const failures: string[] = []
  // Độ trễ 3 giây GIỮA hai ảnh (giữ từ nhánh main, commit 7f4e914): workflow n8n
  // dựng ảnh mất vài giây, bắn hai lượt sát nhau thì ảnh thứ hai (Tổng ngày) dễ
  // trượt. Không áp cho ảnh ĐẦU TIÊN — chờ vô ích làm ca trưởng tưởng treo.
  let isFirstReport = true
  for (const report of input.reports) {
    if (!isFirstReport) await new Promise((resolve) => window.setTimeout(resolve, N8N_REPORT_GAP_MS))
    isFirstReport = false
    let outcome: SingleReportOutcome = { ok: false, message: 'Chưa gửi.' }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      outcome = await postSingleReport(user, input, report, accessToken)
      if (outcome.ok || outcome.fatalMode) break
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700))
    }
    if (outcome.ok) {
      jobs[report.kind] = outcome.job
      continue
    }
    if (outcome.fatalMode) {
      // Lỗi cấu hình áp dụng cho mọi ảnh — gửi tiếp các ảnh còn lại là vô ích.
      return { queued: false, mode: outcome.fatalMode, message: outcome.message, jobs }
    }
    failures.push(`${report.label}: ${outcome.message}`)
  }

  const queued = input.reports.every((report) => jobs[report.kind]?.queued === true)
  return {
    queued,
    mode: queued ? 'n8n' : 'error',
    message: queued
      ? input.sendNow
        ? `Đã yêu cầu n8n gửi ngay ${input.reports.length} ảnh Zalo.`
        : `Đã đưa ${input.reports.length} ảnh vào lịch gửi tự động n8n.`
      : `Chưa gửi được ${failures.length}/${input.reports.length} ảnh (${failures.join(' · ')}). Ảnh đã gửi thành công sẽ không bị gửi trùng khi thử lại.`,
    jobs,
  }
}
