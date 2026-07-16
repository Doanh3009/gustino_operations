import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { branchName as configuredBranchName } from '../lib/branches'
import { permittedBranchIds } from '../lib/attendance'
import { T, useLang } from '../lib/i18n'
import { supabase, uniqueChannelName } from '../lib/supabase'
import {
  fetchSupplyRequests,
  updateSupplyRequestStatus,
  type SupplyRequest,
  type SupplyRequestStatus,
} from '../lib/supplyRequests'
import type { AppUser } from '../types'

interface Props {
  user: AppUser
}

const KITCHEN_RINGTONE_URL = '/audio/hachimi-mambo.mp3'
let kitchenAudio: HTMLAudioElement | null = null

export function KitchenPage({ user }: Props) {
  const lang = useLang()
  const tx = T[lang]
  const [requests, setRequests] = useState<SupplyRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [busyId, setBusyId] = useState('')
  const seenPendingIds = useRef<Set<string>>(new Set())
  const initialized = useRef(false)
  const branchIds = useMemo(
    () => permittedBranchIds(user),
    [user],
  )

  const refresh = useCallback(async () => {
    const nextRequests = await fetchSupplyRequests(user, branchIds)
    const pendingIds = new Set(nextRequests.filter((item) => item.status === 'pending').map((item) => item.id))
    const newest = initialized.current
      ? nextRequests.find((item) => item.status === 'pending' && !seenPendingIds.current.has(item.id))
      : undefined
    setRequests(nextRequests)
    if (!pendingIds.size) stopKitchenBell()
    seenPendingIds.current = pendingIds
    initialized.current = true
    if (newest) notifyKitchen(newest, tx)
  }, [branchIds, tx, user])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchSupplyRequests(user, branchIds)
      .then((items) => {
        if (!active) return
        setRequests(items)
        if (!items.some((item) => item.status === 'pending')) stopKitchenBell()
        seenPendingIds.current = new Set(items.filter((item) => item.status === 'pending').map((item) => item.id))
        initialized.current = true
      })
      .catch((reason) => setFeedback(reason instanceof Error ? reason.message : tx.kitchenLoadError))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [branchIds, tx.kitchenLoadError, user])

  useEffect(() => {
    const timer = window.setInterval(() => void refresh().catch(() => {}), 8000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const channel = client
      .channel(uniqueChannelName(`kitchen-orders-${user.id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supply_requests' }, () => {
        void refresh().catch(() => {})
      })
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [refresh, user.id])

  useEffect(() => {
    const hasPending = requests.some((item) => item.status === 'pending')
    if (!hasPending) return
    const timer = window.setInterval(() => void playKitchenBell(), 60000)
    return () => window.clearInterval(timer)
  }, [requests])

  useEffect(() => {
    const unlock = () => {
      void primeKitchenBell()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => 'denied')
      }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  async function changeStatus(request: SupplyRequest, status: SupplyRequestStatus) {
    setBusyId(request.id)
    try {
      await updateSupplyRequestStatus(user, request.id, status)
      setRequests((items) => {
        const nextItems = items.map((item) =>
          item.id === request.id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
        )
        if (!nextItems.some((item) => item.status === 'pending')) stopKitchenBell()
        return nextItems
      })
      if (status === 'acknowledged' || status === 'cancelled' || status === 'fulfilled') stopKitchenBell()
      setFeedback(status === 'acknowledged'
        ? tx.kitchenAcceptedFeedback
        : status === 'cancelled'
          ? cancelFeedback
          : tx.kitchenFinishedFeedback)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : tx.kitchenUpdateError)
    } finally {
      setBusyId('')
    }
  }

  const isManager = user.role === 'manager' || user.role === 'admin'
  const pending = requests.filter((item) => item.status === 'pending')
  const acknowledged = requests.filter((item) => item.status === 'acknowledged')
  const fulfilled = requests.filter((item) => item.status === 'fulfilled')
  const cancelled = requests.filter((item) => item.status === 'cancelled')
  const cancelFeedback = lang === 'en' ? 'Kitchen order cancelled.' : 'Đã hủy đơn đặt bếp.'
  const cancelLabel = lang === 'en' ? 'Cancel order' : 'Hủy đơn'
  const cancelledTitle = lang === 'en' ? 'Cancelled' : 'Đã hủy'
  const cancelledEmpty = lang === 'en' ? 'No cancelled orders.' : 'Chưa có đơn bị hủy.'
  const alarmTitle = lang === 'en' ? `${pending.length} NEW KITCHEN ORDERS` : `CÓ ${pending.length} ĐƠN BẾP MỚI`
  const alarmHint = lang === 'en'
    ? 'Confirm quickly so the shift leader knows the order was received.'
    : 'Bếp xác nhận ngay để ca trưởng biết đã nhận đơn.'
  const successFeedbacks: string[] = [
    tx.kitchenBellFeedback,
    tx.kitchenAcceptedFeedback,
    tx.kitchenFinishedFeedback,
    cancelFeedback,
  ]
  const isSuccessFeedback = successFeedbacks.includes(feedback)

  return (
    <div className="page kitchen-page">
      <header className="kitchen-hero">
        <div>
          <span className="eyebrow dark">{isManager ? 'QUẢN LÝ ĐẶT BẾP' : tx.kitchenEyebrow}</span>
          <h1>{isManager ? 'Toàn bộ đơn đặt bếp' : tx.kitchenHeading}</h1>
          <p>{isManager
            ? `Theo dõi và xử lý đơn từ ${branchIds.length} chi nhánh. Tổng ${requests.length} đơn · ${pending.length} chờ xử lý.`
            : tx.kitchenHint}</p>
        </div>
      </header>

      {feedback && <div className={`feedback-bar${isSuccessFeedback ? ' success' : ''}`}>{feedback}</div>}

      {pending.length > 0 && (
        <section className="kitchen-alarm-strip" role="status" aria-live="assertive">
          <strong>{alarmTitle}</strong>
          <span>{alarmHint}</span>
        </section>
      )}

      <section className="kitchen-stats">
        <article className={pending.length ? 'hot' : ''}><small>{tx.kitchenPending}</small><strong>{pending.length}</strong></article>
        <article><small>{tx.kitchenWorking}</small><strong>{acknowledged.length}</strong></article>
        <article><small>{tx.kitchenDone}</small><strong>{fulfilled.length}</strong></article>
      </section>

      <section className="kitchen-columns">
        <KitchenColumn
          title={tx.kitchenNewOrders}
          emptyText={loading ? tx.kitchenLoading : tx.kitchenNoNew}
          requests={pending}
          busyId={busyId}
          nextLabel={tx.kitchenAccept}
          savingLabel={tx.kitchenSaving}
          cancelLabel={cancelLabel}
          onNext={(request) => void changeStatus(request, 'acknowledged')}
          onCancel={(request) => void changeStatus(request, 'cancelled')}
        />
        <KitchenColumn
          title={tx.kitchenInProgress}
          emptyText={tx.kitchenNoWorking}
          requests={acknowledged}
          busyId={busyId}
          nextLabel={tx.kitchenFinish}
          savingLabel={tx.kitchenSaving}
          cancelLabel={cancelLabel}
          onNext={(request) => void changeStatus(request, 'fulfilled')}
          onCancel={(request) => void changeStatus(request, 'cancelled')}
        />
        <KitchenColumn
          title={tx.kitchenCompleted}
          emptyText={tx.kitchenNoDone}
          requests={fulfilled}
          busyId={busyId}
          savingLabel={tx.kitchenSaving}
        />
        <KitchenColumn
          title={cancelledTitle}
          emptyText={cancelledEmpty}
          requests={cancelled}
          busyId={busyId}
          savingLabel={tx.kitchenSaving}
        />
      </section>
    </div>
  )
}

function KitchenColumn({
  title,
  emptyText,
  requests,
  busyId,
  nextLabel,
  savingLabel,
  cancelLabel,
  onNext,
  onCancel,
}: {
  title: string
  emptyText: string
  requests: SupplyRequest[]
  busyId: string
  nextLabel?: string
  savingLabel: string
  cancelLabel?: string
  onNext?: (request: SupplyRequest) => void
  onCancel?: (request: SupplyRequest) => void
}) {
  return (
    <div className="kitchen-column">
      <div className="kitchen-column-head">
        <h2>{title}</h2>
        <span>{requests.length}</span>
      </div>
      <div className="kitchen-order-list">
        {requests.map((request) => (
          <article key={request.id} className={`kitchen-order-card ${request.status}`}>
            <div className="kitchen-order-top">
              <strong>{request.productName}</strong>
              <span>{formatTime(request.createdAt)}</span>
            </div>
            <p>{formatQuantity(request.quantity)} {request.unit}</p>
            <small>{branchName(request.branchId)} · {request.requestedByName}</small>
            {request.note && <em>{request.note}</em>}
            {(nextLabel || cancelLabel) && (
              <div className="kitchen-order-actions">
                {nextLabel && onNext && (
                  <button className="primary-button" disabled={busyId === request.id} onClick={() => onNext(request)}>
                    {busyId === request.id ? savingLabel : nextLabel}
                  </button>
                )}
                {cancelLabel && onCancel && (
                  <button className="secondary-button danger-lite" disabled={busyId === request.id} onClick={() => onCancel(request)}>
                    {busyId === request.id ? savingLabel : cancelLabel}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {!requests.length && <p className="empty-copy">{emptyText}</p>}
      </div>
    </div>
  )
}

function notifyKitchen(request: SupplyRequest | undefined, tx: typeof T[keyof typeof T]) {
  void playKitchenBell()
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(tx.kitchenNotificationTitle, {
      body: request ? `${request.productName} - ${formatQuantity(request.quantity)} ${request.unit}` : tx.kitchenNotificationFallback,
    })
  }
}

function getKitchenAudio() {
  if (!kitchenAudio) {
    kitchenAudio = new Audio(KITCHEN_RINGTONE_URL)
    kitchenAudio.preload = 'auto'
    kitchenAudio.volume = 1
  }
  return kitchenAudio
}

async function primeKitchenBell() {
  const audio = getKitchenAudio()
  const oldVolume = audio.volume
  audio.volume = 0
  try {
    await audio.play()
    audio.pause()
    audio.currentTime = 0
  } catch {
    // Browser may still block sound until a later explicit interaction.
  } finally {
    audio.volume = oldVolume
  }
}

async function playKitchenBell() {
  const audio = getKitchenAudio()
  if (!audio.paused && !audio.ended) return
  audio.volume = 1
  audio.currentTime = 0
  try {
    await audio.play()
    return
  } catch {
    playFallbackBell()
  }
}

function stopKitchenBell() {
  if (!kitchenAudio) return
  kitchenAudio.pause()
  kitchenAudio.currentTime = 0
}

function playFallbackBell() {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextCtor) return
  const context = new AudioContextCtor()
  const now = context.currentTime
  ;[0, 0.12, 0.24, 0.52, 0.64, 0.76, 1.08, 1.2].forEach((offset, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = index % 2 ? 'square' : 'sawtooth'
    oscillator.frequency.value = index % 2 ? 1180 : 880
    gain.gain.setValueAtTime(0.001, now + offset)
    gain.gain.exponentialRampToValueAtTime(0.78, now + offset + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.16)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now + offset)
    oscillator.stop(now + offset + 0.17)
  })
  window.setTimeout(() => void context.close().catch(() => {}), 1800)
}

function branchName(branchId: string) {
  return configuredBranchName(branchId) || branchId
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
