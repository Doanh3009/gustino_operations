import { useEffect, useMemo, useState } from 'react'
import { PRODUCTS } from '../lib/constants'
import { createId } from '../lib/browser'
import { calculateStock, ensureOperationDay, getOperationDay } from '../lib/store'
import { fetchShiftRegistrations } from '../lib/attendance'
import { supabase } from '../lib/supabase'
import { localDateKey } from '../lib/dates'
import type { Page } from '../components/AppShell'
import {
  closeBagShift,
  fetchBagAllocations,
  fetchBagShiftSessions,
  issueBags,
  settleBagAllocation,
  startBagShift,
  uploadBagShiftPhoto,
} from '../lib/shiftLedger'
import type { AppUser, BagAllocation, BagShiftSession, OperationDay, ShiftRegistration, StockMovement } from '../types'

const BAG_PRODUCTS = PRODUCTS.filter((product) => product.category === 'finished' && product.unit === 'túi')

function shiftLabel(sequence: number) {
  if (sequence === 1) return 'Ca sáng'
  if (sequence === 2) return 'Ca tối'
  return `Ca ${sequence}`
}

interface IssueLineDraft {
  id: string
  productId: string
  quantity: string
}

interface IssueEmployeeDraft {
  id: string
  employeeId: string
  employeeName: string
  lines: IssueLineDraft[]
}

const newIssueLine = (): IssueLineDraft => ({
  id: createId(),
  productId: BAG_PRODUCTS[0]?.id || '',
  quantity: '',
})

const newIssueDraft = (): IssueEmployeeDraft => ({
  id: createId(),
  employeeId: '',
  employeeName: '',
  lines: [newIssueLine()],
})

export function ShiftHandoverPage({
  user,
  movements,
  onChanged,
  onNavigate,
}: {
  user: AppUser
  movements: StockMovement[]
  onChanged: () => Promise<void>
  onNavigate: (page: Page) => void
}) {
  const today = localDateKey()
  const [sessions, setSessions] = useState<BagShiftSession[]>([])
  const [allocations, setAllocations] = useState<BagAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [issueDrafts, setIssueDrafts] = useState<IssueEmployeeDraft[]>([newIssueDraft()])
  const [settlements, setSettlements] = useState<Record<string, { sold: string; returned: string; damaged: string }>>({})
  const [closingBalances, setClosingBalances] = useState<Record<string, string>>({})
  const [discrepancyNote, setDiscrepancyNote] = useState('')
  const [openingPhoto, setOpeningPhoto] = useState('')
  const [closingPhoto, setClosingPhoto] = useState('')
  const [operationDay, setOperationDay] = useState<OperationDay | null>(null)

  const openSession = sessions.find((item) => item.status === 'open')
  const todaySessions = sessions.filter((item) => item.businessDate === today)
  const dayClosed = operationDay?.status === 'closed'
  const maxShiftsReached = !openSession && todaySessions.length >= 2
  const stock = useMemo(() => calculateStock(movements), [movements])
  const openAllocations = allocations.filter((item) => !item.settledAt)
  const currentShiftAllocations = openSession
    ? allocations.filter((item) =>
        !item.settledAt || item.shiftId === openSession.id || item.settlementShiftId === openSession.id,
      )
    : []
  const availableBalances = useMemo(
    () => calculateAvailableBalances(stock, allocations),
    [stock, allocations],
  )
  const registeredEmployees = useMemo(() => {
    const unique = new Map<string, ShiftRegistration>()
    registrations
      .filter((registration) =>
        registration.branchId === user.branchId
        && registration.workDate === today
        && registration.status !== 'rejected'
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.userName.localeCompare(b.userName, 'vi'))
      .forEach((registration) => {
        if (!unique.has(registration.userId)) unique.set(registration.userId, registration)
      })
    return Array.from(unique.values())
  }, [registrations, today, user.branchId])
  const allocationGroups = useMemo(() => groupAllocationsByEmployee(currentShiftAllocations), [currentShiftAllocations])

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const [nextSessions, nextAllocations, nextRegistrations] = await Promise.all([
        fetchBagShiftSessions(user, { branchId: user.branchId }),
        fetchBagAllocations(user, { branchId: user.branchId }),
        fetchShiftRegistrations(user, { branchId: user.branchId, from: today, to: today }),
      ])
      setSessions(nextSessions)
      setAllocations(nextAllocations)
      setRegistrations(nextRegistrations)
      void getOperationDay(user.branchId, today).then(setOperationDay).catch(() => {})
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể tải sổ túi theo ca.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void refresh(true) }, [user.id, user.branchId])
  useEffect(() => {
    const client = supabase
    if (!client) {
      const timer = window.setInterval(() => void refresh(), 5000)
      return () => window.clearInterval(timer)
    }
    const channel = client.channel(`bag-ledger:${user.branchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bag_shift_sessions',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refresh())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bag_allocations',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refresh())
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [user.branchId, user.id])
  useEffect(() => {
    const openingUrl = openSession?.openingPhotoUrl
    const closingUrl = openSession?.closingPhotoUrl
    setOpeningPhoto(openingUrl || localStorage.getItem(shiftPhotoKey(user.branchId, today, 'opening')) || '')
    setClosingPhoto(closingUrl || localStorage.getItem(shiftPhotoKey(user.branchId, today, 'closing')) || '')
  }, [today, user.branchId, openSession?.id, openSession?.openingPhotoUrl, openSession?.closingPhotoUrl])
  useEffect(() => {
    if (!openSession) return
    setClosingBalances(Object.fromEntries(
      BAG_PRODUCTS.map((product) => [product.id, String(availableBalances[product.id] || 0)]),
    ))
  }, [openSession?.id, JSON.stringify(availableBalances)])
  async function handleStartShift() {
    if (dayClosed) {
      setFeedback('Ngày vận hành đã kết thúc. Sang ngày mới hệ thống sẽ cho nhận ca mới.')
      return
    }
    if (todaySessions.length >= 2) {
      setFeedback('Hôm nay đã đủ 2 ca (Ca sáng và Ca tối). Không thể nhận thêm ca mới.')
      return
    }
    setBusy(true)
    try {
      const day = await ensureOperationDay(user, today)
      setOperationDay(day)
      const openingBalances = Object.fromEntries(BAG_PRODUCTS.map((product) => {
        return [product.id, Math.max(0, availableBalances[product.id] || 0)]
      }))
      let session = await startBagShift(user, today, openingBalances)
      if (openingPhoto && !session.openingPhotoUrl) {
        session = await uploadBagShiftPhoto(user, session, 'opening', openingPhoto).catch(() => session)
      }
      setFeedback(`Đã nhận ${shiftLabel(session.sequence)}. Tồn đầu ca đã được lấy tự động.`)
      await refresh()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể nhận ca.')
    } finally {
      setBusy(false)
    }
  }

  async function saveShiftPhoto(kind: 'opening' | 'closing', file: File | undefined) {
    if (!file) return
    if (dayClosed) {
      setFeedback('Ngày vận hành đã kết thúc, không thể thêm ảnh bàn giao cho ngày này.')
      return
    }
    const dataUrl = await fileToDataUrl(file)
    localStorage.setItem(shiftPhotoKey(user.branchId, today, kind), dataUrl)
    if (kind === 'opening') setOpeningPhoto(dataUrl)
    else setClosingPhoto(dataUrl)
    if (openSession) {
      try {
        await uploadBagShiftPhoto(user, openSession, kind, dataUrl)
        await refresh()
        setFeedback(kind === 'opening' ? 'Đã đồng bộ ảnh quầy đầu ca vào sổ ca.' : 'Đã đồng bộ ảnh quầy cuối ca vào sổ ca.')
        return
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : 'Không thể đồng bộ ảnh bàn giao.')
        return
      }
    }
    setFeedback(kind === 'opening' ? 'Đã giữ ảnh đầu ca. Ảnh sẽ đồng bộ khi nhận ca.' : 'Đã giữ ảnh cuối ca. Ảnh sẽ đồng bộ khi ca đang mở.')
  }

  function updateIssueDraft(id: string, patch: Partial<IssueEmployeeDraft>) {
    setIssueDrafts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function setIssueProductQuantity(draftId: string, productId: string, quantity: string) {
    setIssueDrafts((items) => items.map((draft) => draft.id === draftId
      ? {
          ...draft,
          lines: draft.lines.some((line) => line.productId === productId)
            ? draft.lines.map((line) => line.productId === productId ? { ...line, quantity } : line)
            : [...draft.lines, { id: createId(), productId, quantity }],
        }
      : draft))
  }

  async function handleIssue(event: React.FormEvent) {
    event.preventDefault()
    if (!openSession) return
    if (dayClosed) {
      setFeedback('Ngày vận hành đã kết thúc, không thể phát thêm túi.')
      return
    }
    const rows = issueDrafts.flatMap((draft) => draft.lines
      .map((line) => ({
        employeeId: draft.employeeId,
        employeeName: draft.employeeName.trim(),
        productId: line.productId,
        issuedQuantity: Number(line.quantity),
      }))
      .filter((line) => line.issuedQuantity > 0))
    if (!rows.length) {
      setFeedback('Hãy nhập ít nhất một dòng túi cần phát.')
      return
    }
    if (rows.some((row) => !row.employeeId || !row.employeeName)) {
      setFeedback('Mỗi nhóm phát túi phải chọn nhân viên đã đăng ký ca hôm nay.')
      return
    }
    if (rows.some((row) => !Number.isFinite(row.issuedQuantity) || row.issuedQuantity <= 0 || !Number.isInteger(row.issuedQuantity))) {
      setFeedback('Số túi phát phải là số nguyên lớn hơn 0.')
      return
    }
    const requestedByProduct = rows.reduce<Record<string, number>>((map, row) => {
      map[row.productId] = (map[row.productId] || 0) + row.issuedQuantity
      return map
    }, {})
    const overIssued = Object.entries(requestedByProduct).find(([nextProductId, quantity]) => quantity > (availableBalances[nextProductId] || 0))
    if (overIssued) {
      const product = PRODUCTS.find((item) => item.id === overIssued[0])
      setFeedback(`${product?.name || 'Loại túi này'} chỉ còn ${formatNumber(availableBalances[overIssued[0]] || 0)} túi tại quầy.`)
      return
    }
    setBusy(true)
    try {
      await Promise.all(rows.map((row) => issueBags(user, openSession, row)))
      setIssueDrafts([newIssueDraft()])
      setFeedback(`Đã ghi nhận ${rows.length} dòng phát túi cho nhân viên.`)
      await refresh()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể phát túi.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSettle(allocation: BagAllocation) {
    if (!openSession) return
    if (dayClosed) {
      setFeedback('Ngày vận hành đã kết thúc, không thể đối soát thêm.')
      return
    }
    const recordedSold = soldQuantity(allocation)
    const values = settlements[allocation.id] || { sold: '', returned: '', damaged: '' }
    const damaged = Math.max(0, Number(values.damaged || 0))
    const maxDamaged = Math.max(0, allocation.issuedQuantity - recordedSold)
    if (damaged > maxDamaged) {
      setFeedback(`Hỏng/mất không thể vượt quá ${formatNumber(maxDamaged)} túi còn lại sau khi bán.`)
      return
    }
    const returned = Math.max(0, allocation.issuedQuantity - recordedSold - damaged)
    setBusy(true)
    try {
      await settleBagAllocation(
        user,
        openSession,
        allocation,
        recordedSold,
        returned,
        damaged,
      )
      setSettlements((current) => {
        const next = { ...current }
        delete next[allocation.id]
        return next
      })
      setFeedback('Đã thu túi. Số bán lấy từ hóa đơn POS, số trả lại được tự tính.')
      await refresh()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể đối soát túi.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCloseShift() {
    if (!openSession) return
    if (dayClosed) {
      setFeedback('Ngày vận hành đã kết thúc, không thể chốt thêm ca.')
      return
    }
    const soldButNotSettled = openAllocations.filter((item) => soldQuantity(item) > 0)
    if (soldButNotSettled.length) {
      setFeedback(`Có ${soldButNotSettled.length} dòng PG đã ghi bán nhưng chưa đối soát. Hãy thu/trả/hỏng cho các dòng này trước khi chốt ca.`)
      return
    }
    const actual = Object.fromEntries(BAG_PRODUCTS.map((product) => [
      product.id,
      Math.max(0, Number(closingBalances[product.id] ?? availableBalances[product.id] ?? 0)),
    ]))
    const hasDiscrepancy = BAG_PRODUCTS.some((product) =>
      Math.abs((actual[product.id] || 0) - (availableBalances[product.id] || 0)) > 0.001,
    )
    if (hasDiscrepancy && !discrepancyNote.trim()) {
      setFeedback('Có lệch túi. Hãy nhập lý do ngắn trước khi bàn giao.')
      return
    }
    setBusy(true)
    try {
      const unposted = allocations.filter((item) =>
        item.settlementShiftId === openSession.id && item.settledAt && !item.postedAt,
      )
      if (closingPhoto && !openSession.closingPhotoUrl) {
        await uploadBagShiftPhoto(user, openSession, 'closing', closingPhoto).catch(() => null)
      }
      const now = new Date()
      const movementRows: StockMovement[] = []
      for (const allocation of unposted) {
        const sold = soldQuantity(allocation)
        if (sold > 0) {
          movementRows.push({
            id: createId(),
            documentId: openSession.id,
            branchId: user.branchId,
            productId: allocation.productId,
            type: 'sale_out',
            quantity: sold,
            shiftDate: today,
            note: `[${shiftLabel(openSession.sequence)}] ${allocation.employeeName} bán ${formatNumber(sold)} túi`,
            createdBy: user.id,
            createdAt: now.toISOString(),
          })
        }
        if (allocation.damagedQuantity > 0) {
          movementRows.push({
            id: createId(),
            documentId: openSession.id,
            branchId: user.branchId,
            productId: allocation.productId,
            type: 'waste',
            quantity: allocation.damagedQuantity,
            shiftDate: today,
            note: `[${shiftLabel(openSession.sequence)}] ${allocation.employeeName} báo hỏng/mất`,
            createdBy: user.id,
            createdAt: now.toISOString(),
          })
        }
      }
      const stillHeld = outstandingByProduct(openAllocations)
      BAG_PRODUCTS.forEach((product) => {
        movementRows.push({
          id: createId(),
          documentId: openSession.id,
          branchId: user.branchId,
          productId: product.id,
          type: 'count',
          quantity: (actual[product.id] || 0) + (stillHeld[product.id] || 0),
          shiftDate: today,
          note: `[${shiftLabel(openSession.sequence)}] Kiểm đếm bàn giao: tại quầy ${actual[product.id] || 0}, nhân viên đang giữ ${stillHeld[product.id] || 0}`,
          createdBy: user.id,
          createdAt: new Date(now.getTime() + 5).toISOString(),
        })
      })
      await closeBagShift(
        user,
        openSession,
        actual,
        discrepancyNote,
        unposted.map((item) => item.id),
        movementRows.map((row) => ({
          id: row.id,
          product_id: row.productId,
          movement_type: row.type,
          quantity: row.quantity,
          shift_date: row.shiftDate,
          note: row.note,
          document_id: row.documentId || openSession.id,
          source_product_id: row.sourceProductId || null,
          source_quantity: row.sourceQuantity || null,
          measured_weight_kg: row.measuredWeightKg || null,
          created_at: row.createdAt,
        })),
      )
      setDiscrepancyNote('')
      localStorage.removeItem(shiftPhotoKey(user.branchId, today, 'opening'))
      localStorage.removeItem(shiftPhotoKey(user.branchId, today, 'closing'))
      setOpeningPhoto('')
      setClosingPhoto('')
      setFeedback(`Đã chốt ${shiftLabel(openSession.sequence)}. Ca sau sẽ nhận đúng số thực tế vừa đếm.`)
      await Promise.all([refresh(), onChanged()])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể chốt bàn giao ca.'
      setFeedback(`Không thể chốt bàn giao ca: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page"><section className="section-card">Đang tải sổ túi theo ca…</section></div>

  return (
    <div className="page handover-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">SỔ TÚI THEO CA</span>
          <h1>Nhận ca · Phát túi · Bàn giao</h1>
          <p>Ghi túi phát cho nhân viên và đếm số còn tại quầy khi hết ca.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`handover-shift-chip ${openSession ? 'open' : ''}`}>
            {openSession ? `${shiftLabel(openSession.sequence)} đang mở` : 'Chưa nhận ca'}
          </span>
          <button className="handover-link-sales" onClick={() => onNavigate('sales')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>
            Xem sổ bán hàng
          </button>
        </div>
      </div>

      {feedback && <div className="feedback-bar">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      {!openSession && !maxShiftsReached && (
        <section className="handover-start-card">
          <span>1</span>
          <div>
            <small>{todaySessions.length === 0 ? 'CA SÁNG' : 'CA TỐI'}</small>
            <h2>Nhận {todaySessions.length === 0 ? 'Ca sáng' : 'Ca tối'}</h2>
            <p>Hệ thống tự lấy tồn quầy từ lần bàn giao trước và tách riêng số túi nhân viên còn giữ.</p>
            {openAllocations.length > 0 && <strong>{openAllocations.length} lượt túi từ ca trước chưa đối soát</strong>}
            <label className="shift-photo-button">
              <input type="file" accept="image/*" capture="environment" onChange={(event) => void saveShiftPhoto('opening', event.target.files?.[0])} />
              📷 Chụp ảnh quầy đầu ca
            </label>
            {openingPhoto && <img className="shift-photo-preview" src={openingPhoto} alt="Ảnh quầy đầu ca" />}
          </div>
          <button className="primary-button" disabled={busy} onClick={handleStartShift}>Nhận ca</button>
        </section>
      )}

      {maxShiftsReached && !dayClosed && (
        <section className="handover-start-card">
          <span>✓</span>
          <div>
            <small>ĐÃ ĐỦ CA HÔM NAY</small>
            <h2>Ca sáng và Ca tối đã bàn giao</h2>
            <p>Hôm nay đã hoàn thành 2 ca. Vào <strong>Cuối ca</strong> để chốt báo cáo ngày.</p>
          </div>
        </section>
      )}

      {openSession && (
        <>
          <section className="handover-balance-grid">
            {visibleProducts(openSession, movements, currentShiftAllocations).map((product) => {
              const held = outstandingByProduct(openAllocations)[product.id] || 0
              return (
                <article key={product.id}>
                  <small>{product.name}</small>
                  <strong>{formatNumber(availableBalances[product.id] || 0)}</strong>
                  <span>còn tại quầy</span>
                  {held > 0 && <em>{formatNumber(held)} túi nhân viên đang giữ</em>}
                </article>
              )
            })}
          </section>

          <div className="handover-columns">
            <form className="entry-card handover-issue-form" onSubmit={handleIssue}>
              <div className="section-title"><div><span className="eyebrow dark">PHÁT TÚI</span><h2>Một nhân viên · nhiều sản phẩm</h2></div><b>2</b></div>
              <p className="handover-step-help">Chọn nhân viên, nhập số lượng ở nhiều loại túi cần giao, rồi bấm một lần để phát tất cả.</p>
              <div className="issue-draft-list compact">
                {issueDrafts.slice(0, 1).map((draft) => {
                  const selectedLines = draft.lines.filter((line) => Number(line.quantity) > 0)
                  const selectedTotal = selectedLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
                  return (
                  <div className="issue-draft-card issue-matrix-card" key={draft.id}>
                    <label className="issue-employee-select">Nhân viên nhận túi
                      <select value={draft.employeeId} onChange={(event) => {
                        const employee = registeredEmployees.find((item) => item.userId === event.target.value)
                        updateIssueDraft(draft.id, {
                          employeeId: event.target.value,
                          employeeName: employee?.userName || '',
                        })
                      }} required disabled={!registeredEmployees.length}>
                        <option value="">{registeredEmployees.length ? 'Chọn nhân viên trong ca' : 'Chưa có nhân viên đăng ký ca hôm nay'}</option>
                        {registeredEmployees.map((employee) => (
                          <option key={employee.userId} value={employee.userId}>
                            {employee.userName} · {employee.startTime}-{employee.endTime}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="issue-product-matrix" aria-label="Chọn nhiều sản phẩm để phát trong một lần">
                      {BAG_PRODUCTS.map((product) => {
                      const line = draft.lines.find((item) => item.productId === product.id)
                      const selectedAvailable = availableBalances[product.id] || 0
                      const quantity = line?.quantity || ''
                      return (
                        <label className={selectedAvailable <= 0 ? 'issue-product-cell empty' : Number(quantity) > 0 ? 'issue-product-cell active' : 'issue-product-cell'} key={product.id}>
                          <span>
                            <strong>{product.name}</strong>
                            <small>Còn {formatNumber(selectedAvailable)}</small>
                          </span>
                            <input
                              type="number"
                              min="1"
                              max={selectedAvailable}
                              step="1"
                              value={quantity}
                              disabled={selectedAvailable <= 0}
                              onChange={(event) => setIssueProductQuantity(draft.id, product.id, event.target.value)}
                              placeholder="0"
                            />
                        </label>
                      )
                    })}
                    </div>
                    <div className="issue-submit-bar">
                      <span>{selectedLines.length ? `${selectedLines.length} loại · ${formatNumber(selectedTotal)} túi` : 'Chưa nhập số lượng'}</span>
                      <button className="primary-button" disabled={busy || !registeredEmployees.length || selectedLines.length === 0}>
                        Phát tất cả
                      </button>
                    </div>
                  </div>
                  )
                })}
              </div>
              {!registeredEmployees.length && (
                <div className="issue-availability empty">
                  Vào Chấm công để đăng ký ca cho nhân viên trước, sau đó quay lại phát túi.
                </div>
              )}
            </form>

            <section className="section-card handover-employee-list">
              <div className="section-title"><div><span className="eyebrow dark">THU TÚI</span><h2>Nhân viên đang giữ</h2></div><span className="date-chip">{currentShiftAllocations.length}</span></div>
              <p className="handover-step-help">Không nhập số bán ở đây. Mỗi đơn bán tạo hóa đơn trong màn Bán hàng; khi thu túi, hệ thống tự lấy số đã bán và tính số trả lại.</p>
              {!currentShiftAllocations.length && <p className="empty-copy">Chưa phát túi cho nhân viên trong ca này.</p>}
              {allocationGroups.map((group) => (
                <article className="allocation-group" key={group.key}>
                  <div className="allocation-group-head">
                    <strong>{group.employeeName}</strong>
                    <small>{group.items.length} dòng túi</small>
                  </div>
                  {group.items.map((allocation) => {
                    const product = PRODUCTS.find((item) => item.id === allocation.productId)
                    const recordedSold = soldQuantity(allocation)
                    const values = settlements[allocation.id] || { sold: '', returned: '', damaged: '' }
                    const damagedValue = Number(values.damaged || 0)
                    const maxDamaged = Math.max(0, allocation.issuedQuantity - recordedSold)
                    const returnedValue = Math.max(0, allocation.issuedQuantity - recordedSold - damagedValue)
                    const remainingValue = Math.max(0, allocation.issuedQuantity - recordedSold)
                    const setDamage = (nextValue: number) => {
                      setSettlements((current) => ({
                        ...current,
                        [allocation.id]: {
                          ...values,
                          damaged: nextValue > 0 ? String(Math.min(Math.max(0, nextValue), maxDamaged)) : '',
                        },
                      }))
                    }
                    return (
                      <div className={allocation.settledAt ? 'allocation-row settled' : 'allocation-row'} key={allocation.id}>
                        <div className="allocation-main">
                          <span><strong>{product?.name}</strong><small>{allocation.shiftId !== openSession.id && !allocation.settledAt ? 'Chuyển từ ca trước' : 'Phát trong ca'}</small></span>
                          <b>{allocation.issuedQuantity} túi</b>
                        </div>
                        {allocation.settledAt ? (
                          <div className="allocation-result">
                            <span>Bán <strong>{soldQuantity(allocation)}</strong></span>
                            <span>Trả <strong>{allocation.returnedQuantity}</strong></span>
                            <span>Hỏng <strong>{allocation.damagedQuantity}</strong></span>
                          </div>
                        ) : (
                          <div className="settle-smart-card">
                            <div className="settle-smart-grid">
                              <span>
                                <small>Đã bán POS</small>
                                <strong>{formatNumber(recordedSold)}</strong>
                              </span>
                              <span>
                                <small>Còn cần thu</small>
                                <strong>{formatNumber(remainingValue)}</strong>
                              </span>
                              <span>
                                <small>Tự trả lại</small>
                                <strong>{formatNumber(returnedValue)}</strong>
                              </span>
                            </div>
                            <div className="damage-stepper">
                              <span>Hỏng/mất</span>
                              <button type="button" disabled={damagedValue <= 0} onClick={() => setDamage(damagedValue - 1)} aria-label="Giảm hỏng mất">−</button>
                              <input
                                inputMode="numeric"
                                value={values.damaged}
                                max={maxDamaged}
                                onChange={(event) => setSettlements((current) => ({ ...current, [allocation.id]: { ...values, damaged: clampIntegerText(event.target.value, maxDamaged) } }))}
                                placeholder="0"
                              />
                              <button type="button" disabled={damagedValue >= maxDamaged} onClick={() => setDamage(damagedValue + 1)} aria-label="Tăng hỏng mất">+</button>
                            </div>
                            <button className="settle-action-button" type="button" disabled={busy || recordedSold > allocation.issuedQuantity} onClick={() => handleSettle(allocation)}>
                              Xác nhận thu
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </article>
              ))}
            </section>
          </div>

          <section className="section-card handover-close-card">
            <div className="section-title"><div><span className="eyebrow dark">CHỐT & BÀN GIAO</span><h2>{openSession ? `Bàn giao ${shiftLabel(openSession.sequence)}` : 'Đếm số còn tại quầy'}</h2></div><b>3</b></div>
            <p className="handover-hint">Số dự kiến đã tự tính. Bạn chỉ sửa nếu số đếm thực tế khác.</p>
            <div className="handover-count-grid">
              {visibleProducts(openSession, movements, currentShiftAllocations).map((product) => {
                const expected = availableBalances[product.id] || 0
                const actual = Number(closingBalances[product.id] ?? expected)
                return (
                  <label className={actual !== expected ? 'different' : ''} key={product.id}>
                    <span>{product.name}</span>
                    <small>Dự kiến {formatNumber(expected)}</small>
                    <input type="number" min="0" step="1" value={closingBalances[product.id] ?? String(expected)} onChange={(event) => setClosingBalances((current) => ({ ...current, [product.id]: event.target.value }))} />
                  </label>
                )
              })}
            </div>
            <label className="handover-note">Ghi chú khi có chênh lệch
              <textarea value={discrepancyNote} onChange={(event) => setDiscrepancyNote(event.target.value)} placeholder="Ví dụ: thiếu 1 túi 330g do rách bao bì" />
            </label>
            <div className="shift-photo-row">
              <label className="shift-photo-button">
                <input type="file" accept="image/*" capture="environment" onChange={(event) => void saveShiftPhoto('closing', event.target.files?.[0])} />
                📷 Chụp ảnh quầy cuối ca
              </label>
              {closingPhoto && <img className="shift-photo-preview" src={closingPhoto} alt="Ảnh quầy cuối ca" />}
            </div>
            {openAllocations.length > 0 && <div className="handover-warning">Có {openAllocations.length} lượt túi nhân viên vẫn đang giữ. Hệ thống sẽ chuyển nguyên trạng sang ca sau.</div>}
            <button className="primary-button wide" disabled={busy} onClick={handleCloseShift}>Chốt & bàn giao ca</button>
          </section>
        </>
      )}

      {todaySessions.filter((item) => item.status === 'closed').length > 0 && (
        <section className="section-card handover-history">
          <div className="section-title"><div><span className="eyebrow dark">HÔM NAY</span><h2>Các ca đã bàn giao</h2></div></div>
          {todaySessions.filter((item) => item.status === 'closed').map((session) => (
            <div key={session.id}>
              <span>
                <strong>{shiftLabel(session.sequence)} · {session.leaderName}</strong>
                <small>{formatTime(session.startedAt)} – {session.endedAt ? formatTime(session.endedAt) : ''} · {session.openingPhotoUrl ? 'có ảnh đầu ca' : 'thiếu ảnh đầu ca'} · {session.closingPhotoUrl ? 'có ảnh cuối ca' : 'thiếu ảnh cuối ca'}</small>
              </span>
              <b>Đã bàn giao</b>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function groupAllocationsByEmployee(allocations: BagAllocation[]) {
  const groups = new Map<string, { key: string; employeeName: string; items: BagAllocation[] }>()
  allocations.forEach((allocation) => {
    const key = allocation.employeeId || allocation.employeeName.trim().toLocaleLowerCase('vi')
    const current = groups.get(key) || { key, employeeName: allocation.employeeName, items: [] }
    current.items.push(allocation)
    groups.set(key, current)
  })
  return Array.from(groups.values()).map((group) => ({
    ...group,
    items: group.items.sort((a, b) => a.productId.localeCompare(b.productId) || a.issuedAt.localeCompare(b.issuedAt)),
  }))
}

function clampIntegerText(value: string, max: number) {
  const numeric = Number(value.replace(/\D/g, ''))
  if (!Number.isFinite(numeric) || numeric <= 0) return ''
  return String(Math.min(numeric, max))
}

async function fileToDataUrl(file: File) {
  try {
    const bitmap = await createImageBitmap(file)
    const maxSize = 1280
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Không thể xử lý ảnh bàn giao.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', 0.78)
  } catch {
    return readFileAsDataUrl(file)
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function shiftPhotoKey(branchId: string, date: string, kind: 'opening' | 'closing') {
  return `gustino_shift_${branchId}_${date}_${kind}_photo`
}

function calculateAvailableBalances(
  stock: ReturnType<typeof calculateStock>,
  allocations: BagAllocation[],
) {
  const outstanding = outstandingByProduct(allocations.filter((item) => !item.settledAt))
  const consumedNotPosted: Record<string, number> = {}
  allocations.filter((item) => !item.postedAt).forEach((item) => {
    consumedNotPosted[item.productId] = (consumedNotPosted[item.productId] || 0)
      + soldQuantity(item)
      + item.damagedQuantity
  })
  return Object.fromEntries(BAG_PRODUCTS.map((product) => {
    const totalStock = stock.find((line) => line.product.id === product.id)?.expected || 0
    return [product.id, Math.max(0,
      totalStock
      - (outstanding[product.id] || 0)
      - (consumedNotPosted[product.id] || 0),
    )]
  }))
}

function outstandingByProduct(allocations: BagAllocation[]) {
  const result: Record<string, number> = {}
  allocations.forEach((item) => {
    const stillHeld = Math.max(0,
      item.issuedQuantity
      - soldQuantity(item)
      - item.returnedQuantity
      - item.damagedQuantity,
    )
    result[item.productId] = (result[item.productId] || 0) + stillHeld
  })
  return result
}

function visibleProducts(session: BagShiftSession, movements: StockMovement[], allocations: BagAllocation[]) {
  const ids = new Set<string>()
  BAG_PRODUCTS.forEach((product) => {
    if ((session.openingBalances[product.id] || 0) > 0) ids.add(product.id)
  })
  movements.filter((item) => item.type === 'packing_in' && item.createdAt >= session.startedAt).forEach((item) => ids.add(item.productId))
  allocations.forEach((item) => ids.add(item.productId))
  if (!ids.size) BAG_PRODUCTS.slice(0, 4).forEach((product) => ids.add(product.id))
  return BAG_PRODUCTS.filter((product) => ids.has(product.id))
}

function soldQuantity(allocation: BagAllocation) {
  if (typeof allocation.soldQuantity === 'number') return Math.max(0, allocation.soldQuantity)
  return allocation.settledAt
    ? Math.max(0, allocation.issuedQuantity - allocation.returnedQuantity - allocation.damagedQuantity)
    : 0
}

function formatNumber(value: number) { return Number(value.toFixed(2)).toLocaleString('vi-VN') }
function formatTime(value: string) { return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) }
