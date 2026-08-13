import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser, EmployeeProfile } from '../types'
import { localDateKey } from '../lib/dates'
import { useConfiguredBranches } from '../lib/branches'
import { fetchEmployees } from '../lib/attendance'
import { fetchSalesReceiptsRange, type SalesReceipt } from '../lib/salesReceipts'
import { fetchKpiRevenueAdjustments, type KpiRevenueAdjustment } from '../lib/kpiRevenueAdjustments'
import { loadBranchKpiOverrides } from '../lib/branchKpiFormulas'
import {
  buildCompetitionBoardRows,
  summarizeCompetitionTeam,
  type CompetitionBoardRow,
} from '../lib/employeeCompetitionBoard'
import { positionKpiKey, type KpiPositionKey } from '../lib/commission'

/**
 * Bảng thi đua cho MỌI nhân viên (#competition).
 *
 * Cố tình rút gọn so với bảng thi đua trong trang Quản trị:
 *  - KHÔNG có nút xuất Excel / xuất ảnh.
 *  - KHÔNG hiện giờ công, số ca, tiền thưởng hay chấm công của người khác.
 *  - Chỉ có tên, vị trí, doanh thu, % KPI và hạng, trong đúng chi nhánh của mình.
 *
 * Mục đích là để nhân viên biết mình đang đứng đâu mà cố gắng, không phải để
 * theo dõi lẫn nhau.
 */

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatMoney(value: number) {
  return `${Math.round(value || 0).toLocaleString('vi-VN')}đ`
}

function formatPercent(value: number) {
  return `${(Math.round(value * 10) / 10).toLocaleString('vi-VN')}%`
}

export function CompetitionBoardPage({ user }: { user: AppUser }) {
  const todayKey = localDateKey()
  const branches = useConfiguredBranches({ user })
  const [month, setMonth] = useState(() => todayKey.slice(0, 7))
  const [scope, setScope] = useState<'month' | 'today'>('month')
  // Loc theo nhom vi tri: so nguoi cung vi tri voi nhau moi cong bang.
  const [groupFilter, setGroupFilter] = useState<'all' | 'mine' | KpiPositionKey>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [receipts, setReceipts] = useState<SalesReceipt[]>([])
  const [adjustments, setAdjustments] = useState<KpiRevenueAdjustment[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])

  const range = useMemo(() => {
    if (scope === 'today') return { from: todayKey, to: todayKey }
    return monthBounds(month)
  }, [scope, month, todayKey])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Mức KPI Admin chỉnh phải có TRƯỚC khi dựng bảng, nếu không nhân viên nhìn
      // thấy chỉ tiêu khác với bảng của quản lý.
      await loadBranchKpiOverrides(user)
      const [nextReceipts, nextEmployees, nextAdjustments] = await Promise.all([
        fetchSalesReceiptsRange(user, { branchIds: [user.branchId], from: range.from, to: range.to }),
        fetchEmployees(user).catch(() => [] as EmployeeProfile[]),
        fetchKpiRevenueAdjustments(user, { branchIds: [user.branchId], from: range.from, to: range.to })
          .catch(() => [] as KpiRevenueAdjustment[]),
      ])
      setReceipts(nextReceipts)
      setEmployees(nextEmployees)
      setAdjustments(nextAdjustments)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được bảng thi đua.')
    } finally {
      setLoading(false)
    }
  }, [user, range.from, range.to])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const reload = () => { void load() }
    const reloadWhenVisible = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
  }, [load])

  const rows = useMemo(() => buildCompetitionBoardRows({
    receipts,
    adjustments,
    employees,
    branchId: user.branchId,
    from: range.from,
    to: range.to,
    meId: user.id,
  }), [receipts, adjustments, employees, user.branchId, user.id, range.from, range.to])

  const myRow = rows.find((row) => row.isMe)
  const myPosition = myRow ? rows.findIndex((row) => row.isMe) + 1 : 0
  const myGroup = myRow?.positionGroup
    || positionKpiKey(user.role, user.employmentType, user.positionTitle || '')
  const team = useMemo(() => summarizeCompetitionTeam(rows, user.branchId), [rows, user.branchId])
  const visibleRows = useMemo(() => {
    if (groupFilter === 'all') return rows
    const wanted = groupFilter === 'mine' ? myGroup : groupFilter
    return rows.filter((row) => row.positionGroup === wanted)
  }, [rows, groupFilter, myGroup])
  const achievedCount = team.achievedCount
  const branchName = branches.find((branch) => branch.id === user.branchId)?.name || user.branchId
  const [year, monthNumber] = month.split('-')

  return (
    <div className="page competition-board-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">THI ĐUA</span>
          <h1>Bảng thi đua · {branchName}</h1>
        </div>
        <span className="date-chip">{achievedCount}/{rows.length} có ngày đạt KPI</span>
      </div>

      {error && <div className="feedback-bar error">{error}<button type="button" onClick={() => { setError(''); void load() }}>Thử lại</button></div>}

      <div className="board-toolbar">
        <div className="board-scope" role="group" aria-label="Phạm vi thi đua">
          <button type="button" className={scope === 'today' ? 'active' : ''} onClick={() => setScope('today')}>Hôm nay</button>
          <button type="button" className={scope === 'month' ? 'active' : ''} onClick={() => setScope('month')}>Cả tháng</button>
        </div>
        {scope === 'month' && (
          <div className="board-month-nav" aria-label="Chọn tháng">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Tháng trước">‹</button>
            <span>Tháng {Number(monthNumber)}/{year}</span>
            <button
              type="button"
              disabled={month >= todayKey.slice(0, 7)}
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="Tháng sau"
            >›</button>
          </div>
        )}
        <label className="board-group-filter">Xem nhóm
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value as typeof groupFilter)}>
            <option value="all">Tất cả vị trí</option>
            <option value="mine">Cùng vị trí với tôi</option>
            <option value="pg_part_time">PG Part-time</option>
            <option value="pg_full_time">PG Full-time</option>
            <option value="shift_deputy">Ca phó</option>
          </select>
        </label>
      </div>

      <section className="board-team" aria-label="Kết quả cả điểm bán">
        <div className="board-team-head">
          <span className="eyebrow dark">CẢ ĐIỂM BÁN</span>
          <strong>{formatPercent(team.progress)}</strong>
        </div>
        <div className="board-team-stats">
          <article><small>Doanh thu chi nhánh</small><b>{formatMoney(team.revenue)}</b></article>
          <article><small>Chỉ tiêu cả nhóm</small><b>{formatMoney(team.target)}</b></article>
          <article className={team.achievedCount ? 'ok' : ''}><small>Có ngày đạt KPI</small><b>{team.achievedCount}/{team.memberCount}</b></article>
        </div>
        <div className="board-me-bar" role="img" aria-label={`Cả điểm bán đạt ${formatPercent(team.progress)} chỉ tiêu`}>
          <span style={{ width: `${Math.min(100, Math.max(0, team.progress))}%` }} />
        </div>
      </section>

      {myRow && (
        <section className="board-me" aria-label="Kết quả của tôi">
          <div className="board-me-head">
            <span className="eyebrow dark">CỦA TÔI</span>
            <strong>Hạng {myPosition}/{rows.length}</strong>
          </div>
          <div className="board-me-stats">
            <article><small>Doanh thu</small><b>{formatMoney(myRow.revenue)}</b></article>
            <article><small>Chỉ tiêu</small><b>{formatMoney(myRow.target)}</b></article>
            <article className={myRow.progress >= 100 ? 'ok' : ''}><small>Đạt</small><b>{formatPercent(myRow.progress)}</b></article>
            <article><small>Xếp loại</small><b>{myRow.rank}</b></article>
          </div>
          <div className="board-me-bar" role="img" aria-label={`Đạt ${formatPercent(myRow.progress)} chỉ tiêu`}>
            <span style={{ width: `${Math.min(100, Math.max(0, myRow.progress))}%` }} />
          </div>
          {myRow.progress < 100 && myRow.target > myRow.revenue && (
            <p className="board-me-gap">Còn {formatMoney(myRow.target - myRow.revenue)} nữa là đạt chỉ tiêu.</p>
          )}
        </section>
      )}

      {loading && <p className="empty-copy">Đang tải bảng thi đua…</p>}
      {!loading && !visibleRows.length && (
        <p className="empty-copy">
          {rows.length ? 'Không có ai thuộc nhóm vị trí này.' : 'Chưa có dữ liệu thi đua trong kỳ này.'}
        </p>
      )}

      {!loading && !!visibleRows.length && (
        <section className="board-list" aria-label="Bảng xếp hạng">
          {visibleRows.map((row, index) => (
            <BoardRow key={row.employeeKey} row={row} place={index + 1} showDays={scope === 'month'} />
          ))}
        </section>
      )}

      <p className="board-footnote">
        Bảng này chỉ hiển thị doanh thu và mức đạt KPI. Giờ công, số ca và tiền thưởng của từng người
        không hiển thị ở đây — xem công của chính bạn ở tab <b>Xem công</b> trong màn Chấm công.
        Ca trưởng được xếp ở bảng riêng theo doanh thu ca vận hành trong trang Quản trị.
      </p>
    </div>
  )
}

function BoardRow({ row, place, showDays }: { row: CompetitionBoardRow; place: number; showDays: boolean }) {
  const progress = Math.min(100, Math.max(0, row.progress))
  return (
    <article className={`board-row${row.isMe ? ' me' : ''}${row.progress >= 100 ? ' achieved' : ''}`}>
      <span className={`board-place place-${place <= 3 ? place : 'rest'}`}>{place}</span>
      <div className="board-row-main">
        <div className="board-row-name">
          <strong>{row.employeeName}{row.isMe ? ' (bạn)' : ''}</strong>
          <small>{row.positionLabel}</small>
        </div>
        <div className="board-row-bar"><span style={{ width: `${progress}%` }} /></div>
        {/* Số ngày ĐẠT CHỈ TIÊU — không phải số ca đi làm, không phải giờ công. */}
        {showDays && row.activeDays > 0 && (
          <small className="board-row-days">{row.achievedDays}/{row.activeDays} ngày đạt chỉ tiêu</small>
        )}
      </div>
      <div className="board-row-values">
        <b>{formatMoney(row.revenue)}</b>
        <small>{formatPercent(row.progress)} · {row.rank}</small>
      </div>
    </article>
  )
}
