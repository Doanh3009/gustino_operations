import { useEffect, useState } from 'react'
import {
  attendanceAppUrl,
  copyAttendanceLink,
  detectDeviceEnvironment,
  deviceReadinessIssues,
  openInSystemBrowser,
  readGeolocationPermission,
  type DeviceEnvironment,
  type GeolocationPermission,
} from '../lib/deviceReadiness'
import { probeAttendanceLocation } from '../lib/attendance'

type ProbeState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'ok'; accuracy: number; address: string }
  | { state: 'fail'; message: string }

/**
 * Thẻ tự kiểm tra máy trước khi chấm công.
 * Khi máy có rào cản (mở trong Zalo/Facebook, link không HTTPS, quyền vị trí bị chặn)
 * thì hiện cảnh báo lớn kèm nút xử lý; khi máy ổn thì thu về một dòng gọn, bấm mới xổ.
 */
export function AttendanceDeviceCheck() {
  const [environment] = useState<DeviceEnvironment>(detectDeviceEnvironment)
  const [permission, setPermission] = useState<GeolocationPermission>('unknown')
  const [expanded, setExpanded] = useState(false)
  const [probe, setProbe] = useState<ProbeState>({ state: 'idle' })
  const [linkNote, setLinkNote] = useState('')

  useEffect(() => {
    let alive = true
    void readGeolocationPermission().then((state) => {
      if (alive) setPermission(state)
    })
    return () => {
      alive = false
    }
  }, [])

  const issues = deviceReadinessIssues(environment, permission)
  const blocker = issues.find((issue) => issue.level === 'blocker')

  async function runProbe() {
    setProbe({ state: 'running' })
    const result = await probeAttendanceLocation()
    setProbe(result.ok
      ? { state: 'ok', accuracy: result.accuracy, address: result.address }
      : { state: 'fail', message: result.message })
    setPermission(await readGeolocationPermission())
  }

  async function handleCopy() {
    const copied = await copyAttendanceLink()
    setLinkNote(copied
      ? 'Đã sao chép link. Mở Chrome/Safari, dán vào ô địa chỉ rồi đăng nhập.'
      : `Hãy chép tay địa chỉ này: ${attendanceAppUrl()}`)
  }

  if (blocker) {
    return (
      <section className="devchk devchk-alert" aria-live="polite">
        <header className="devchk-alert-head">
          <span className="devchk-alert-icon" aria-hidden="true">!</span>
          <div>
            <strong>{blocker.title}</strong>
            <p>{blocker.detail}</p>
          </div>
        </header>
        {issues.length > 1 && (
          <ul className="devchk-issue-list">
            {issues.slice(1).map((issue) => (
              <li key={issue.id}><b>{issue.title}.</b> {issue.detail}</li>
            ))}
          </ul>
        )}
        <div className="devchk-actions">
          {environment.isInAppBrowser && (
            <button type="button" className="devchk-primary" onClick={() => openInSystemBrowser()}>
              Mở bằng trình duyệt điện thoại
            </button>
          )}
          <button type="button" className="devchk-secondary" onClick={() => void handleCopy()}>
            Sao chép link app
          </button>
          {blocker.id === 'location-denied' && (
            <button type="button" className="devchk-secondary" onClick={() => void runProbe()} disabled={probe.state === 'running'}>
              {probe.state === 'running' ? 'Đang thử lấy vị trí…' : 'Thử lại quyền vị trí'}
            </button>
          )}
        </div>
        {linkNote && <p className="devchk-note">{linkNote}</p>}
        {probe.state === 'fail' && <p className="devchk-note devchk-note-bad">{probe.message}</p>}
        {probe.state === 'ok' && <p className="devchk-note devchk-note-good">Đã lấy được vị trí (sai số ±{Math.round(probe.accuracy)}m). Bạn chấm công được rồi.</p>}
        <DeviceFacts environment={environment} permission={permission} />
      </section>
    )
  }

  return (
    <section className={`devchk devchk-ok${expanded ? ' expanded' : ''}`}>
      <button type="button" className="devchk-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="devchk-dot" aria-hidden="true" />
        <span className="devchk-summary-text">
          <strong>Máy sẵn sàng chấm công</strong>
          <small>{environment.browserLabel}{permission === 'granted' ? ' · đã cấp quyền vị trí' : ''}</small>
        </span>
        <span className="devchk-caret" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="devchk-body">
          <p className="devchk-note">Nếu nút chấm công quay lâu hoặc báo lỗi vị trí, bấm nút dưới đây để biết máy đang vướng ở đâu.</p>
          <div className="devchk-actions">
            <button type="button" className="devchk-primary" onClick={() => void runProbe()} disabled={probe.state === 'running'}>
              {probe.state === 'running' ? 'Đang kiểm tra vị trí…' : 'Kiểm tra vị trí ngay'}
            </button>
          </div>
          {probe.state === 'ok' && (
            <p className="devchk-note devchk-note-good">
              Lấy vị trí thành công, sai số ±{Math.round(probe.accuracy)}m — {probe.address}
            </p>
          )}
          {probe.state === 'fail' && <p className="devchk-note devchk-note-bad">{probe.message}</p>}
          <DeviceFacts environment={environment} permission={permission} />
        </div>
      )}
    </section>
  )
}

function DeviceFacts({ environment, permission }: { environment: DeviceEnvironment; permission: GeolocationPermission }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Trình duyệt', value: environment.browserLabel },
    { label: 'Máy', value: environment.deviceModel || platformLabel(environment) },
    { label: 'Kết nối', value: environment.isSecureContext ? 'HTTPS an toàn' : 'Không phải HTTPS' },
    { label: 'Quyền vị trí', value: permissionLabel(permission) },
  ]
  return (
    <dl className="devchk-facts">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function platformLabel(environment: DeviceEnvironment) {
  if (environment.platform === 'android') return 'Android'
  if (environment.platform === 'ios') return 'iPhone/iPad'
  if (environment.platform === 'desktop') return 'Máy tính'
  return 'Không rõ'
}

function permissionLabel(permission: GeolocationPermission) {
  if (permission === 'granted') return 'Đã cho phép'
  if (permission === 'denied') return 'Đang bị chặn'
  if (permission === 'prompt') return 'Sẽ hỏi khi chấm công'
  return 'Không kiểm tra được'
}
