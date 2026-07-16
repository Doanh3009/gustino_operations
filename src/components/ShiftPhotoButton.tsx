import { useRef, useState, type ChangeEvent } from 'react'

// 1 nút duy nhất: bấm vào mở lựa chọn "Chụp ảnh" hoặc "Tải ảnh lên".
// Dùng chung cho ảnh đầu ca / cuối ca ở trang Hôm nay và Bàn giao ca.
export function ShiftPhotoButton({
  prefix,
  compact = false,
  onPick,
}: {
  prefix: string
  compact?: boolean
  onPick: (file: File | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    onPick(event.target.files?.[0])
    event.currentTarget.value = ''
    setOpen(false)
  }
  return (
    <span className={compact ? 'shift-photo-picker compact' : 'shift-photo-picker'}>
      <button
        type="button"
        className="shift-photo-button always-visible"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        📷 {prefix}
      </button>
      {open && (
        <span className="shift-photo-choices">
          <button type="button" onClick={() => cameraRef.current?.click()}>📷 Chụp ảnh</button>
          <button type="button" onClick={() => uploadRef.current?.click()}>🖼 Tải ảnh lên</button>
        </span>
      )}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={pick} hidden />
      <input ref={uploadRef} type="file" accept="image/*" onChange={pick} hidden />
    </span>
  )
}
