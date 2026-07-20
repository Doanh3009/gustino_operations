interface PaginationProps {
  total: number
  page: number
  pageSize: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

export function Pagination({
  total,
  page,
  pageSize,
  pageSizeOptions = [10, 20, 50],
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const start = total ? (safePage - 1) * pageSize + 1 : 0
  const end = Math.min(safePage * pageSize, total)
  const pages = visiblePages(safePage, totalPages)

  return (
    <nav className="admin-pagination" aria-label="Phân trang dữ liệu">
      <span className="admin-pagination-total">{start}–{end} / {total} bản ghi</span>
      <label>Số dòng
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <div className="admin-pagination-pages">
        <button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>‹</button>
        {pages.map((item, index) => item === 'ellipsis'
          ? <span key={`ellipsis-${index}`}>…</span>
          : <button type="button" key={item} className={item === safePage ? 'active' : ''} aria-current={item === safePage ? 'page' : undefined} onClick={() => onPageChange(item)}>{item}</button>)}
        <button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>›</button>
      </div>
    </nav>
  )
}

function visiblePages(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const items: Array<number | 'ellipsis'> = [1]
  if (current > 4) items.push('ellipsis')
  for (let page = Math.max(2, current - 1); page <= Math.min(total - 1, current + 1); page += 1) items.push(page)
  if (current < total - 3) items.push('ellipsis')
  items.push(total)
  return items
}
