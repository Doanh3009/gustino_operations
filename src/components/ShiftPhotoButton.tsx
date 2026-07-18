import { useRef, type ChangeEvent } from 'react'

// Một nút duy nhất; điện thoại tự mở lựa chọn Camera/Thư viện ảnh của hệ điều hành.
export function ShiftPhotoButton({
  prefix,
  compact = false,
  onPick,
}: {
  prefix: string
  compact?: boolean
  onPick: (file: File | undefined) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    onPick(event.target.files?.[0])
    event.currentTarget.value = ''
  }
  return (
    <span className={compact ? 'shift-photo-picker compact' : 'shift-photo-picker'}>
      <button
        type="button"
        className="shift-photo-button always-visible"
        onClick={() => inputRef.current?.click()}
      >
        📷 {prefix}
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={pick} hidden />
    </span>
  )
}
