const HOURS_24 = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
const MINUTES_60 = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))

interface Time24FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

/** Bộ chọn 24h độc lập locale/thiết lập AM-PM của máy tính. */
export function Time24Field({ label, value, onChange, disabled, className = '' }: Time24FieldProps) {
  const [hour, minute] = splitTime(value)
  return (
    <div className={`time-24-field ${className}`.trim()}>
      <div className="time-24-label"><span>{label}</span><small>24H · 00–23</small></div>
      <div className="time-24-controls">
        <select aria-label={`${label} · giờ (24h)`} value={hour} disabled={disabled} onChange={(event) => onChange(`${event.target.value}:${minute}`)}>
          {HOURS_24.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <b aria-hidden="true">:</b>
        <select aria-label={`${label} · phút`} value={minute} disabled={disabled} onChange={(event) => onChange(`${hour}:${event.target.value}`)}>
          {MINUTES_60.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
    </div>
  )
}

interface DateTime24FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function DateTime24Field({ label, value, onChange, disabled }: DateTime24FieldProps) {
  const [datePart = '', timePart = '00:00'] = value.split('T')
  return (
    <div className="datetime-24-field">
      <label>
        <span>{label} · ngày</span>
        <input
          type="date"
          value={datePart}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value ? `${event.target.value}T${splitTime(timePart).join(':')}` : '')}
          required
        />
      </label>
      <Time24Field
        label={`${label} · giờ`}
        value={timePart}
        disabled={disabled}
        onChange={(nextTime) => onChange(datePart ? `${datePart}T${nextTime}` : value)}
      />
    </div>
  )
}

function splitTime(value: string) {
  const match = String(value || '').match(/(\d{2}):(\d{2})/)
  const hour = match && Number(match[1]) >= 0 && Number(match[1]) <= 23 ? match[1] : '00'
  const minute = match && Number(match[2]) >= 0 && Number(match[2]) <= 59 ? match[2] : '00'
  return [hour, minute]
}
