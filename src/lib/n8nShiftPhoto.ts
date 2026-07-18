import { supabase } from './supabase'
import { userHeaders } from './core'
import type { AppUser } from '../types'

const N8N_SHIFT_PHOTO_TIMEOUT_MS = 15_000

export interface ShiftPhotoNotifyInput {
  shiftId: string
  branchId: string
  branchName: string
  businessDate: string
  shiftSequence?: number | null
  kind: 'opening' | 'closing'
  photoUrl: string
  leaderName?: string
}

export interface ShiftPhotoNotifyResult {
  sent: boolean
  mode: 'n8n' | 'disabled' | 'not-configured' | 'skipped' | 'error'
  message?: string
}

/**
 * Gửi thông báo ảnh bàn giao (đầu/cuối ca) cho n8n để lưu Google Drive và gửi Zalo.
 * Không chặn luồng lưu ảnh chính: mọi lỗi trả về mode 'error' để UI có thể hiển thị nhẹ, không throw.
 */
export async function notifyN8nShiftPhoto(user: AppUser, input: ShiftPhotoNotifyInput): Promise<ShiftPhotoNotifyResult> {
  if (!/^https?:\/\//i.test(input.photoUrl)) {
    return { sent: false, mode: 'skipped', message: 'Ảnh chưa có URL công khai (đang dùng ảnh tạm cục bộ).' }
  }
  const accessToken = user.authToken
    || (supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined)
  if (!accessToken) {
    return { sent: false, mode: 'error', message: 'Phiên đăng nhập chưa có token để gửi ảnh sang n8n.' }
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), N8N_SHIFT_PHOTO_TIMEOUT_MS)
  try {
    const response = await fetch('/api/n8n-shift-photo', {
      method: 'POST',
      headers: { ...userHeaders(user), Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      body: JSON.stringify({ ...input, leaderName: input.leaderName || user.name }),
    })
    const responseText = await response.text()
    let payload: { mode?: string; error?: string; code?: string } | null = null
    if (responseText) {
      try { payload = JSON.parse(responseText) } catch { payload = null }
    }
    if (!response.ok) {
      const mode = payload?.code === 'N8N_NOT_CONFIGURED' ? 'not-configured' : 'error'
      return { sent: false, mode, message: payload?.error || `Gửi ảnh sang n8n lỗi HTTP ${response.status}.` }
    }
    if (payload?.mode === 'disabled') return { sent: false, mode: 'disabled', message: payload.error || 'n8n ảnh bàn giao đang tắt.' }
    return { sent: true, mode: 'n8n' }
  } catch (error) {
    return {
      sent: false,
      mode: 'error',
      message: error instanceof DOMException && error.name === 'AbortError'
        ? 'n8n ảnh bàn giao quá thời gian chờ.'
        : 'Không kết nối được máy chủ để gửi ảnh sang n8n.',
    }
  } finally {
    window.clearTimeout(timeout)
  }
}
