/**
 * Bộ component dùng chung cho khu vực quản trị GUSTINO (§79).
 *
 * Mục đích: mọi trang Tổng quan / Doanh thu / Kho / Chấm công dùng CÙNG một
 * ngôn ngữ thiết kế thay vì copy-paste UI giữa các page. Chỉ là lớp trình bày —
 * không chứa business logic, không gọi API (§91).
 *
 * Style nằm ở `src/ui.css`, tiền tố `gt-`.
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/* ── PageHeader ─────────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, context, actions }: {
  title: string
  subtitle?: string
  /** Selector chi nhánh / ngày — chỉ đặt Ở ĐÂY, không lặp xuống dưới (§6). */
  context?: ReactNode
  /** Tối đa 1–2 nút nổi bật, phần còn lại nằm trong OverflowMenu (§7). */
  actions?: ReactNode
}) {
  return (
    <header className="gt-page-header">
      <div className="gt-page-header__title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {context && <div className="gt-page-header__context">{context}</div>}
      {actions && <div className="gt-page-header__actions">{actions}</div>}
    </header>
  )
}

/* ── Filter bar ─────────────────────────────────────────────────────────── */

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="gt-filterbar">{children}</div>
}

export function BranchSelector({ value, onChange, branches, allLabel = 'Tất cả chi nhánh', disabled }: {
  value: string
  onChange: (branchId: string) => void
  branches: Array<{ id: string; name: string }>
  allLabel?: string
  /** Nhân viên có branch cố định thì KHÔNG hiện selector (§33) — trang tự quyết định không render. */
  disabled?: boolean
}) {
  return (
    <label className="gt-field">
      <span>Chi nhánh</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label="Chọn chi nhánh">
        <option value="">{allLabel}</option>
        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>
    </label>
  )
}

export function DateField({ label = 'Ngày', value, onChange, max, min }: {
  label?: string
  value: string
  onChange: (value: string) => void
  max?: string
  min?: string
}) {
  return (
    <label className="gt-field">
      <span>{label}</span>
      <input type="date" value={value} max={max} min={min} onChange={(event) => { if (event.target.value) onChange(event.target.value) }} />
    </label>
  )
}

export function DateRangeField({ from, to, onFrom, onTo, max }: {
  from: string
  to: string
  onFrom: (value: string) => void
  onTo: (value: string) => void
  max?: string
}) {
  return (
    <div className="gt-filterbar__group">
      <DateField label="Từ" value={from} max={to || max} onChange={onFrom} />
      <DateField label="Đến" value={to} min={from} max={max} onChange={onTo} />
    </div>
  )
}

export function QuickDatePresets({ presets, active, onPick }: {
  presets: Array<{ id: string; label: string }>
  active?: string
  onPick: (id: string) => void
}) {
  return (
    <div className="gt-chips" role="group" aria-label="Khoảng thời gian nhanh">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={active === preset.id ? 'is-active' : ''}
          aria-pressed={active === preset.id}
          onClick={() => onPick(preset.id)}
        >{preset.label}</button>
      ))}
    </div>
  )
}

/* ── Metric ─────────────────────────────────────────────────────────────── */

export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="gt-metrics">{children}</div>
}

export function Metric({ label, value, hint, delta }: {
  label: string
  value: string
  hint?: string
  /** Chênh lệch so kỳ trước. `null` = không có cơ sở so sánh, không hiển thị bịa. */
  delta?: { rate: number; label: string } | null
}) {
  const tone = !delta ? '' : Math.abs(delta.rate) < 0.05 ? 'flat' : delta.rate > 0 ? 'up' : 'down'
  return (
    <article className="gt-metric">
      <span className="gt-metric__label">{label}</span>
      <strong className="gt-metric__value">{value}</strong>
      {delta && (
        <span className={`gt-metric__delta ${tone}`}>
          {tone === 'flat' ? '—' : `${delta.rate > 0 ? '↑' : '↓'} ${Math.abs(delta.rate).toFixed(1)}%`} {delta.label}
        </span>
      )}
      {hint && <span className="gt-metric__hint">{hint}</span>}
    </article>
  )
}

/** Summary một dòng — dùng thay cho hàng KPI card lớn (§35, §62). */
export function SummaryLine({ items }: { items: Array<{ text: string; tone?: 'warn' | 'bad' }> }) {
  return (
    <p className="gt-summary-line">
      {items.map((item, index) => (
        <span key={`${item.text}-${index}`}>
          {index > 0 && <i aria-hidden="true"> · </i>}
          <span className={item.tone || ''}>{item.text}</span>
        </span>
      ))}
    </p>
  )
}

/* ── Surface / Section ──────────────────────────────────────────────────── */

/**
 * Sắc pastel của card. CHỈ nhuộm phần đầu card (`gt-section-head`) và viền —
 * vùng dữ liệu giữ nền trắng, vì tô cả card thì số liệu mất tương phản.
 */
export type SurfaceTone = 'mint' | 'rose' | 'sky' | 'sand'

export function Surface({ children, className = '', tone }: {
  children: ReactNode
  className?: string
  tone?: SurfaceTone
}) {
  return <section className={`gt-surface${tone ? ` gt-surface--${tone}` : ''} ${className}`.trim()}>{children}</section>
}

/** Hai card NGANG NHAU để tiết kiệm chiều dọc — KHÔNG gộp hai bảng làm một. */
export function SplitPair({ children }: { children: ReactNode }) {
  return <div className="gt-split-2">{children}</div>
}

export function SectionHeader({ title, description, count, aside }: {
  title: string
  description?: string
  count?: string
  aside?: ReactNode
}) {
  return (
    <div className="gt-section-head">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {(count || aside) && (
        <div className="gt-section-head__aside">
          {count && <span className="gt-section-count">{count}</span>}
          {aside}
        </div>
      )}
    </div>
  )
}

/* ── Badge ──────────────────────────────────────────────────────────────── */

export type BadgeTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral'

/** §85: trạng thái luôn kèm CHỮ, không bao giờ chỉ có màu. */
export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`gt-badge gt-badge--${tone}`}>{children}</span>
}

/* ── Search / chips / view switch ───────────────────────────────────────── */

export function SearchInput({ value, onChange, placeholder, label }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label?: string
}) {
  return (
    <label className="gt-search">
      <span aria-hidden="true">⌕</span>
      {/* type="search" cho bàn phím điện thoại đúng kiểu + nút xóa nhanh. */}
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label || placeholder} />
    </label>
  )
}

export function FilterChips<T extends string>({ options, value, onChange, label }: {
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div className="gt-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={value === option.id ? 'is-active' : ''}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >{option.label}</button>
      ))}
    </div>
  )
}

/** 3 chế độ xem CÙNG một dữ liệu, không phải 3 module riêng (§64). */
export function ViewSwitch<T extends string>({ options, value, onChange, label }: {
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div className="gt-viewswitch" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          className={value === option.id ? 'is-active' : ''}
          onClick={() => onChange(option.id)}
        >{option.label}</button>
      ))}
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="gt-toolbar">{children}</div>
}

/* ── OverflowMenu ───────────────────────────────────────────────────────── */

export interface OverflowItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  /** Chèn đường kẻ TRƯỚC mục này. */
  separatorBefore?: boolean
}

/**
 * Menu `•••` cho action phụ. Chức năng cũ (Excel, audit, lịch sử, báo cáo) được
 * chuyển vào đây chứ KHÔNG bị xoá (§58, §86).
 */
export function OverflowMenu({ items, label = 'Thao tác khác' }: { items: OverflowItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const visible = items.filter(Boolean)
  if (!visible.length) return null
  return (
    <div className="gt-overflow" ref={ref}>
      <button
        type="button"
        className="gt-overflow__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >•••</button>
      {open && (
        <div className="gt-overflow__panel" role="menu">
          {visible.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              {item.separatorBefore && index > 0 && <hr />}
              <button
                type="button"
                role="menuitem"
                className={item.danger ? 'is-danger' : ''}
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onSelect() }}
              >{item.label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Drawer / BottomSheet ───────────────────────────────────────────────── */

/**
 * Một component, hai hình dạng: desktop trượt bên phải, ≤900px thành bottom
 * sheet (§72). Dùng portal để không bị `overflow` của trang cắt mất.
 */
export function Drawer({ open, title, subtitle, onClose, children, footer, wide }: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="gt-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className={`gt-drawer${wide ? ' gt-drawer--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="gt-drawer__head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="gt-drawer__close" onClick={onClose} aria-label="Đóng">×</button>
        </header>
        <div className="gt-drawer__body">{children}</div>
        {footer && <div className="gt-drawer__foot">{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}

/** Dòng đối chiếu trong drawer SKU (§39). */
export function ReconRow({ label, value, tone, total }: {
  label: string
  value: string
  tone?: 'pos' | 'neg'
  total?: boolean
}) {
  return (
    <div className={`gt-recon__row${total ? ' is-total' : ''}`}>
      <span>{label}</span>
      <b className={tone || ''}>{value}</b>
    </div>
  )
}

/* ── ActionSheet ────────────────────────────────────────────────────────── */

export interface SheetAction {
  id: string
  label: string
  hint?: string
  disabled?: boolean
}

/** "+ Phát sinh kho" — một cửa cho mọi loại phiếu (§40). */
export function ActionSheet({ open, title, description, actions, onPick, onClose }: {
  open: boolean
  title: string
  description?: string
  actions: SheetAction[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="gt-sheet-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="gt-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="gt-sheet__head">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <div className="gt-sheet__list">
          {actions.map((action) => (
            <button key={action.id} type="button" disabled={action.disabled} onClick={() => { onClose(); onPick(action.id) }}>
              <strong>{action.label}</strong>
              {action.hint && <small>{action.hint}</small>}
            </button>
          ))}
        </div>
        <div className="gt-sheet__foot">
          <button type="button" className="gt-btn gt-btn--secondary" style={{ width: '100%' }} onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── Empty / Error / Skeleton ───────────────────────────────────────────── */

export function EmptyState({ title, description, action }: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="gt-empty">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ message = 'Không thể tải dữ liệu.', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="gt-empty">
      <strong>{message}</strong>
      {onRetry && <button type="button" className="gt-btn gt-btn--secondary" onClick={onRetry}>Thử lại</button>}
    </div>
  )
}

export function SkeletonRows({ rows = 4, columns = 3 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div className="gt-skeleton-row" key={rowIndex}>
          {Array.from({ length: columns }, (_, cellIndex) => (
            <div className="gt-skeleton" key={cellIndex} style={{ flex: cellIndex === 0 ? 2 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── ResponsiveList ─────────────────────────────────────────────────────── */

/**
 * Lưới cột trên desktop, dòng dọc trên mobile. `columns` là grid-template của
 * desktop; mobile tự xếp lại theo `data-gt-*` trên từng ô (xem `ui.css`).
 */
export function DataList({ columns, children, className = '' }: {
  columns: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`gt-list ${className}`.trim()} style={{ ['--gt-cols' as string]: columns }} role="table">
      {children}
    </div>
  )
}

export function DataHead({ children }: { children: ReactNode }) {
  return <div className="gt-list__head" role="row">{children}</div>
}

export function DataRow({ children, onClick, selected, label }: {
  children: ReactNode
  onClick?: () => void
  selected?: boolean
  label?: string
}) {
  if (!onClick) return <div className="gt-list__row" role="row">{children}</div>
  return (
    <button
      type="button"
      className={`gt-list__row${selected ? ' is-selected' : ''}`}
      role="row"
      aria-label={label}
      aria-expanded={selected}
      onClick={onClick}
    >{children}</button>
  )
}

/* ── Ranking bar ────────────────────────────────────────────────────────── */

export function RankBar({ name, value, meta, share, tone = 'brand' }: {
  name: string
  value: string
  meta?: string
  /** 0–1. Dùng tỉ lệ so với dòng lớn nhất, không phải % tuyệt đối. */
  share: number
  tone?: 'brand' | 'info' | 'warn' | 'bad'
}) {
  const width = `${Math.max(2, Math.min(100, share * 100)).toFixed(1)}%`
  return (
    <div className="gt-rank">
      <div className="gt-rank__top">
        <span className="gt-rank__name">{name}</span>
        <span className="gt-rank__value">{value}</span>
      </div>
      <div className="gt-rank__track"><div className={`gt-rank__fill${tone === 'brand' ? '' : ` is-${tone}`}`} style={{ width }} /></div>
      {meta && <span className="gt-rank__meta">{meta}</span>}
    </div>
  )
}

/* ── Cần xử lý ──────────────────────────────────────────────────────────── */

export interface AttentionItem {
  id: string
  severity: 'bad' | 'warn' | 'info'
  /** Chuyện gì — ví dụ "Hết hàng", "Ca chưa bàn giao". */
  kind: string
  /** Ở đâu / cái gì — ví dụ "Hạt dẻ sơ chế · Lotte Mart Vũng Tàu". */
  where: string
  actionLabel: string
  onAction: () => void
}

/**
 * §17: KHÔNG liệt kê dữ liệu thô. Mỗi dòng phải nói rõ chuyện gì, ở đâu, mức độ
 * và làm gì tiếp theo.
 */
export function AttentionList({ items, emptyTitle = 'Không có cảnh báo', emptyDescription = 'Hiện không có vấn đề cần xử lý.' }: {
  items: AttentionItem[]
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (!items.length) return <EmptyState title={emptyTitle} description={emptyDescription} />
  return (
    <div>
      {items.map((item) => (
        <div className="gt-attention__row" key={item.id}>
          <span className={`gt-attention__dot ${item.severity}`} aria-hidden="true" />
          <span className="gt-attention__body">
            <strong>{item.kind}</strong>
            <small>{item.where}</small>
          </span>
          <button type="button" className="gt-btn gt-btn--secondary gt-btn--sm" onClick={item.onAction}>{item.actionLabel}</button>
        </div>
      ))}
    </div>
  )
}
