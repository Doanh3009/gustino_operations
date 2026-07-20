import type { ReactNode } from 'react'

interface ErpListToolbarProps {
  title: string
  count: number
  search: string
  searchPlaceholder: string
  onSearchChange: (value: string) => void
  primaryLabel?: string
  onPrimary?: () => void
  filters?: ReactNode
  onImport?: () => void
  onExport?: () => void
  onGroup?: () => void
  onFavorite?: () => void
}

export function ErpListToolbar({
  title, count, search, searchPlaceholder, onSearchChange,
  primaryLabel, onPrimary, filters, onImport, onExport, onGroup, onFavorite,
}: ErpListToolbarProps) {
  return (
    <div className="erp-list-control">
      <div className="erp-list-actions">
        {primaryLabel && onPrimary && <button type="button" className="erp-primary-action" onClick={onPrimary}>{primaryLabel}</button>}
        {onImport && <button type="button" onClick={onImport}>Import</button>}
        {onExport && <button type="button" onClick={onExport}>Export</button>}
      </div>
      <label className="erp-search">
        <span aria-hidden="true">⌕</span>
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} aria-label={`Tìm kiếm ${title}`} />
      </label>
      <div className="erp-list-menus">
        {filters && <details>
          <summary>Lọc</summary>
          <div className="erp-filter-popover">{filters}</div>
        </details>}
        {onGroup && <button type="button" onClick={onGroup}>Nhóm</button>}
        {onFavorite && <button type="button" onClick={onFavorite}>Yêu thích</button>}
        <span className="erp-record-count">{count.toLocaleString('vi-VN')} bản ghi</span>
      </div>
    </div>
  )
}
