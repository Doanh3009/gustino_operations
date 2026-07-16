export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function downloadBlob(blob: Blob, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  // Safari/Chrome mobile cần link nằm trong DOM và không được revoke URL ngay,
  // nếu không tải file sẽ im lặng thất bại (nút "không phản hồi").
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    URL.revokeObjectURL(link.href)
    link.remove()
  }, 4000)
}

export async function shareOrDownloadBlob(
  blob: Blob,
  name: string,
  options: { title?: string; text?: string } = {},
): Promise<'shared' | 'downloaded'> {
  const share = navigator.share?.bind(navigator)
  if (share && typeof File !== 'undefined') {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
    const sharePayload = { files: [file], title: options.title, text: options.text }
    const canShareFile = !navigator.canShare || navigator.canShare({ files: [file] })
    if (canShareFile) {
      try {
        await share(sharePayload)
        return 'shared'
      } catch (error) {
        if ((error as DOMException | null)?.name === 'AbortError') {
          throw new Error('Bạn đã đóng bảng chia sẻ nên ảnh chưa được lưu.')
        }
        // Một số bản Safari có navigator.share nhưng từ chối File; dùng tải file chuẩn làm fallback.
      }
    }
  }
  downloadBlob(blob, name)
  return 'downloaded'
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = .95) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size) resolve(blob)
      else reject(new Error('Không thể tạo file ảnh để lưu.'))
    }, type, quality)
  })
}

export interface DecodedCanvasImage {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

/** Decode ảnh camera theo EXIF orientation, có fallback cho Safari/iPhone và ảnh HEIC trình duyệt đọc được. */
export async function decodeImageForCanvas(blob: Blob): Promise<DecodedCanvasImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Safari cũ/HEIC có thể không đi qua createImageBitmap nhưng vẫn hiển thị được bằng HTMLImageElement.
    }
  }
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Thiết bị không đọc được định dạng ảnh này.'))
    })
    image.src = url
    if (typeof image.decode === 'function') await image.decode()
    else await loaded
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Ảnh camera không có kích thước hợp lệ.')
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error instanceof Error ? error : new Error('Thiết bị không đọc được ảnh camera. Hãy đổi định dạng ảnh hoặc chụp lại.')
  }
}

// Nén ảnh selfie/quầy về JPEG ~1280px để lưu nhẹ (dùng chung cho ảnh đầu/cuối ca).
export async function imageFileToDataUrl(file: File) {
  try {
    const decoded = await decodeImageForCanvas(file)
    const maxSize = 1280
    const scale = Math.min(1, maxSize / Math.max(decoded.width, decoded.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Không thể xử lý ảnh.')
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    decoded.close()
    return canvas.toDataURL('image/jpeg', 0.78)
  } catch {
    return readFileAsDataUrl(file)
  }
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    localStorage.removeItem(key)
    return fallback
  }
}
