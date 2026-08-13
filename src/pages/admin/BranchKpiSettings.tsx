import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppUser, Branch } from '../../types'
import {
  KPI_POSITIONS,
  applyBranchKpiOverrides,
  defaultBranchKpiRow,
  fetchBranchKpiFormulas,
  resetBranchKpiFormulas,
  saveBranchKpiFormulas,
  type BranchKpiFormulaRow,
} from '../../lib/branchKpiFormulas'
import { VUNG_TAU_NEW_KPI_FROM, VUNG_TAU_NEW_KPI_TO, type KpiPositionKey } from '../../lib/commission'

/**
 * Bảng "Mức KPI theo chi nhánh" trong Quản trị → Thi đua nhân viên.
 *
 * Mục đích: Admin đổi chỉ tiêu doanh thu ngay trên giao diện, không phải sửa
 * `POSITION_KPI_FORMULAS` rồi build/deploy nữa. Ô nào chưa chỉnh thì hiện đúng
 * mức mặc định đang chạy, nên mở bảng ra là thấy hệ thống đang tính bằng gì.
 */

interface Props {
  user: AppUser
  branches: Branch[]
  selectedBranchId: string
  readOnly: boolean
  /** Gọi lại khi mức KPI đổi để trang cha tính lại bảng xếp hạng ngay. */
  onChanged?: () => void
}

type DraftMap = Record<string, BranchKpiFormulaRow>

function draftKey(branchId: string, position: KpiPositionKey) {
  return `${branchId}|${position}`
}

function buildDrafts(branches: Branch[], saved: BranchKpiFormulaRow[]): DraftMap {
  const savedByKey = new Map(saved.map((row) => [draftKey(row.branchId, row.position), row]))
  const drafts: DraftMap = {}
  branches.forEach((branch) => {
    KPI_POSITIONS.forEach(({ key }) => {
      const id = draftKey(branch.id, key)
      drafts[id] = savedByKey.get(id) || defaultBranchKpiRow(branch.id, key)
    })
  })
  return drafts
}

function formatMoney(value: number) {
  return `${Math.round(value || 0).toLocaleString('vi-VN')}đ`
}

/** Ô nhập tiền: gõ số trần, hiển thị có dấu phân cách ngay bên dưới. */
function cleanAmount(value: string) {
  const digits = value.replace(/[^\d]/g, '').slice(0, 12)
  return digits ? Number(digits) : 0
}

function formatDateLabel(value?: string) {
  const [year, month, day] = String(value || '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : ''
}

/**
 * Ô nhập tiền không nhảy con trỏ.
 *
 * Bản cũ dựng `value` bằng `row[field].toLocaleString('vi-VN')` ngay trong lúc gõ:
 * mỗi phím bấm là chuỗi bị chèn thêm dấu chấm hàng nghìn và React đặt lại giá
 * trị ô ⇒ con trỏ văng về cuối, gõ vào giữa số thì ra số rác. Đó là phần "giật"
 * mà chủ hệ thống thấy. Ngoài ra fallback `'0'` khiến không xoá trắng ô được:
 * lúc nào cũng phải gõ đè lên số 0 đứng đầu.
 *
 * Cách chữa: trong lúc GÕ thì giữ nguyên chuỗi người dùng nhập (chỉ lọc ký tự
 * không phải chữ số), rời ô mới format lại có dấu phân cách.
 */
function AmountInput({ value, onChange, disabled, label }: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  label: string
}) {
  const [typing, setTyping] = useState<string | null>(null)
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      disabled={disabled}
      value={typing ?? (value ? value.toLocaleString('vi-VN') : '')}
      placeholder="0"
      onFocus={() => setTyping(value ? String(value) : '')}
      onChange={(event) => {
        const digits = event.target.value.replace(/[^\d]/g, '').slice(0, 12)
        setTyping(digits)
        onChange(digits ? Number(digits) : 0)
      }}
      onBlur={() => setTyping(null)}
    />
  )
}

export function BranchKpiSettings({ user, branches, selectedBranchId, readOnly, onChanged }: Props) {
  const editable = user.role === 'admin' && !readOnly
  const scopedBranches = useMemo(
    () => branches.filter((branch) => !selectedBranchId || branch.id === selectedBranchId),
    [branches, selectedBranchId],
  )
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<BranchKpiFormulaRow[]>([])
  const [drafts, setDrafts] = useState<DraftMap>({})
  const hasDrafts = Object.keys(drafts).length > 0
  const showInitialLoading = loading && !hasDrafts
  const branchesRef = useRef(branches)
  const hasDraftsRef = useRef(false)
  const dirtyDraftRef = useRef(false)
  branchesRef.current = branches
  hasDraftsRef.current = hasDrafts

  const load = useCallback(async (showBlocking = true, forceDraftReset = false) => {
    if (showBlocking) setLoading(true)
    setError('')
    try {
      const rows = await fetchBranchKpiFormulas(user)
      applyBranchKpiOverrides(rows)
      setSaved(rows)
      if (forceDraftReset || !dirtyDraftRef.current || !hasDraftsRef.current) {
        setDrafts(buildDrafts(branchesRef.current, rows))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không đọc được mức KPI đang cấu hình.')
    } finally {
      if (showBlocking) setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  const savedByKey = useMemo(
    () => new Map(saved.map((row) => [draftKey(row.branchId, row.position), row])),
    [saved],
  )

  function patch(branchId: string, position: KpiPositionKey, change: Partial<BranchKpiFormulaRow>) {
    const id = draftKey(branchId, position)
    dirtyDraftRef.current = true
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || defaultBranchKpiRow(branchId, position)), ...change },
    }))
  }

  function rowOf(branchId: string, position: KpiPositionKey) {
    return drafts[draftKey(branchId, position)] || defaultBranchKpiRow(branchId, position)
  }

  function isDirty(branchId: string) {
    return KPI_POSITIONS.some(({ key }) => {
      const draft = rowOf(branchId, key)
      const base = savedByKey.get(draftKey(branchId, key)) || defaultBranchKpiRow(branchId, key)
      return draft.weekdayTarget !== base.weekdayTarget
        || draft.weekendTarget !== base.weekendTarget
        || draft.monthlyTarget !== base.monthlyTarget
        || draft.headcount !== base.headcount
        || (draft.effectiveFrom || '') !== (base.effectiveFrom || '')
        || (draft.note || '') !== (base.note || '')
    })
  }

  function branchEffectiveFrom(branchId: string) {
    return rowOf(branchId, 'pg_part_time').effectiveFrom || ''
  }

  /** Đã có dòng ghi đè trong DB = chi nhánh này KHÔNG còn chạy mức mặc định. */
  function isOverridden(branchId: string) {
    return saved.some((row) => row.branchId === branchId)
  }

  async function saveBranch(branchId: string) {
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      const rows = KPI_POSITIONS.map(({ key }) => rowOf(branchId, key))
      // 13/08/2026 — BỎ ràng buộc bắt buộc chọn ngày áp dụng.
      //
      // Đây chính là lỗi "chỉnh KPI xong nó giật rồi trở lại như cũ": form bắt
      // buộc chọn ngày, Admin chọn HÔM NAY, nhưng bảng xếp hạng bên dưới đang
      // xem CẢ THÁNG. `activeBranchKpiOverrideFor` bỏ qua override với mọi ngày
      // nhỏ hơn `effectiveFrom`, nên ngày 1 → hôm qua vẫn tính bằng mức mặc
      // định ⇒ con số mới loé lên rồi tụt về mức cũ.
      //
      // Để TRỐNG = áp dụng cho mọi kỳ (đúng hành vi trước migration
      // 20260812_branch_kpi_effective_from). Ai cần chia giai đoạn vẫn điền ngày
      // được — chỉ là không còn bị ép, và ô ngày nói rõ hệ quả.
      await saveBranchKpiFormulas(user, rows)
      dirtyDraftRef.current = false
      await load(false, true)
      onChanged?.()
      const appliedFrom = rows[0]?.effectiveFrom
      setFeedback(appliedFrom
        ? `Đã lưu mức KPI cho ${branches.find((branch) => branch.id === branchId)?.name || branchId}, áp dụng từ ${formatDateLabel(appliedFrom)}.`
          + ' Các ngày TRƯỚC mốc này vẫn giữ mức cũ, nên bảng xếp hạng của kỳ cũ không đổi.'
        : `Đã lưu mức KPI cho ${branches.find((branch) => branch.id === branchId)?.name || branchId}. Áp dụng cho mọi kỳ, bảng xếp hạng tính lại ngay.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không lưu được mức KPI.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreDefaults(branchId: string) {
    const branchName = branches.find((branch) => branch.id === branchId)?.name || branchId
    if (!window.confirm(`Khôi phục mức KPI mặc định cho ${branchName}?\n\nMọi mức đã chỉnh của chi nhánh này sẽ bị xóa và hệ thống quay lại khung gốc trong mã nguồn.`)) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await resetBranchKpiFormulas(user, branchId)
      dirtyDraftRef.current = false
      await load(false, true)
      onChanged?.()
      setFeedback(`Đã khôi phục mức KPI mặc định cho ${branchName}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không khôi phục được mức mặc định.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="kpi-settings-card">
      <header className="kpi-settings-head">
        <div>
          <span className="eyebrow dark">CẤU HÌNH</span>
          <h3>Mức KPI theo chi nhánh</h3>
          <p>Đổi chỉ tiêu doanh thu ngay tại đây — không cần sửa mã nguồn và deploy lại.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Thu gọn' : 'Mở bảng chỉnh KPI'}
        </button>
      </header>

      {open && (
        <div className="kpi-settings-body">
          {error && <div className="feedback-bar error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
          {feedback && <div className="feedback-bar">{feedback}<button type="button" onClick={() => setFeedback('')}>×</button></div>}

          <p className="kpi-settings-note" role="note">
            Ô nào chưa chỉnh sẽ hiện đúng mức mặc định hệ thống đang chạy. <b>Số người</b> chỉ dùng để cộng ra KPI team
            của chi nhánh (Ca trưởng chạy theo KPI team thì để chỉ tiêu cá nhân bằng 0).
            Riêng kỳ Vũng Tàu {VUNG_TAU_NEW_KPI_FROM.split('-').reverse().join('/')}–{VUNG_TAU_NEW_KPI_TO.split('-').reverse().join('/')} đã
            chốt số đối soát nên giữ nguyên, không nhận mức chỉnh mới.
          </p>

          {showInitialLoading && <p className="empty-copy">Đang đọc mức KPI đang cấu hình…</p>}
          {loading && hasDrafts && <p className="kpi-settings-sync">Đang đồng bộ mức KPI mới nhất…</p>}

          {!showInitialLoading && !scopedBranches.length && <p className="empty-copy">Không có chi nhánh nào trong bộ lọc hiện tại.</p>}

          {!showInitialLoading && scopedBranches.map((branch) => (
            <article key={branch.id} className="kpi-settings-branch">
              <div className="kpi-settings-branch-head">
                <div>
                  <strong>{branch.name}</strong>
                  <small>{isOverridden(branch.id)
                    ? `Đang dùng mức đã chỉnh${branchEffectiveFrom(branch.id) ? ` từ ${formatDateLabel(branchEffectiveFrom(branch.id))}` : ' (chưa có ngày áp dụng)'}`
                    : 'Đang dùng mức mặc định'}</small>
                </div>
                {editable && (
                  <div className="kpi-settings-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || !isOverridden(branch.id)}
                      onClick={() => void restoreDefaults(branch.id)}
                    >Khôi phục mặc định</button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy || !isDirty(branch.id)}
                      onClick={() => void saveBranch(branch.id)}
                    >{busy ? 'Đang lưu…' : 'Lưu chi nhánh này'}</button>
                  </div>
                )}
              </div>

              <div className="kpi-settings-table-wrap">
                <table className="kpi-settings-table">
                  <thead>
                    <tr>
                      <th scope="col">Vị trí</th>
                      <th scope="col">Ngày thường</th>
                      <th scope="col">Cuối tuần</th>
                      <th scope="col">Cả tháng</th>
                      <th scope="col">Số người</th>
                    </tr>
                  </thead>
                  <tbody>
                    {KPI_POSITIONS.map(({ key, label, hint }) => {
                      const row = rowOf(branch.id, key)
                      const base = defaultBranchKpiRow(branch.id, key)
                      const changed = row.weekdayTarget !== base.weekdayTarget
                        || row.weekendTarget !== base.weekendTarget
                        || row.monthlyTarget !== base.monthlyTarget
                        || row.headcount !== base.headcount
                      return (
                        <tr key={key} className={changed ? 'changed' : ''}>
                          <th scope="row">
                            <span>{label}</span>
                            <small>{hint}</small>
                          </th>
                          {(['weekdayTarget', 'weekendTarget', 'monthlyTarget'] as const).map((field) => (
                            <td key={field} data-label={field === 'weekdayTarget' ? 'Ngày thường' : field === 'weekendTarget' ? 'Cuối tuần' : 'Cả tháng'}>
                              <AmountInput
                                label={`${label} · ${field === 'weekdayTarget' ? 'ngày thường' : field === 'weekendTarget' ? 'cuối tuần' : 'cả tháng'} · ${branch.name}`}
                                disabled={!editable || busy}
                                value={row[field]}
                                onChange={(next) => patch(branch.id, key, { [field]: next })}
                              />
                              <small>{formatMoney(row[field])}</small>
                            </td>
                          ))}
                          <td data-label="Số người">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              aria-label={`Số người vị trí ${label} tại ${branch.name}`}
                              disabled={!editable || busy}
                              value={row.headcount}
                              onChange={(event) => patch(branch.id, key, { headcount: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
                            />
                            <small>để tính KPI team</small>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {editable && (
                <div className="kpi-settings-meta">
                  <label>Ngày áp dụng
                    <input
                      type="date"
                      value={branchEffectiveFrom(branch.id)}
                      disabled={busy}
                      onChange={(event) => KPI_POSITIONS.forEach(({ key }) => patch(branch.id, key, { effectiveFrom: event.target.value || undefined }))}
                    />
                    <small>
                      {branchEffectiveFrom(branch.id)
                        ? `Chỉ áp dụng từ ${formatDateLabel(branchEffectiveFrom(branch.id))} trở đi — các ngày trước mốc này vẫn tính bằng mức cũ.`
                        : 'Để trống = áp dụng cho mọi kỳ. Chỉ điền khi muốn giữ nguyên số liệu của kỳ cũ.'}
                    </small>
                  </label>
                  <label>Ghi chú thay đổi (ai duyệt)
                    <input
                      type="text"
                      maxLength={300}
                      placeholder="VD: Chủ hệ thống duyệt 10/08/2026."
                      value={rowOf(branch.id, 'pg_part_time').note || ''}
                      onChange={(event) => KPI_POSITIONS.forEach(({ key }) => patch(branch.id, key, { note: event.target.value }))}
                    />
                  </label>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
