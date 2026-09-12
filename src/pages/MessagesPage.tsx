import { useEffect, useRef, useState } from 'react'
import { fetchMessageContacts, fetchMessageHistory, markMessagesRead, sendEmployeeMessage, type EmployeeMessage, type MessageContact } from '../lib/messages'
import { shouldUseLanApi, supabase, uniqueChannelName } from '../lib/supabase'
import type { AppUser } from '../types'

export function MessagesPage({ user }: { user: AppUser }) {
  const [contacts, setContacts] = useState<MessageContact[]>([])
  const [contactId, setContactId] = useState('')
  const [search, setSearch] = useState('')
  const [messages, setMessages] = useState<EmployeeMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [olderLoading, setOlderLoading] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [reload, setReload] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)
  const conversationRef = useRef('')
  const historyContactRef = useRef('')
  const refreshInboxRef = useRef<(() => void) | null>(null)
  conversationRef.current = contactId
  const contact = contacts.find((item) => item.id === contactId)
  const broadcast = user.role === 'admin' && contactId === '*'
  const visibleContacts = contacts.filter((item) => item.name.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')))

  useEffect(() => {
    let active = true
    let reading = false
    let pending = false
    let initial = true
    setLoading(true)
    const refreshInbox = () => {
      if (reading) { pending = true; return }
      reading = true
      void fetchMessageContacts(user).then((rows) => {
      if (!active) return
      setContacts(rows)
      if (initial) { setContactId(rows[0]?.id || ''); initial = false }
    }).catch((reason) => { if (active) setError(reason.message) }).finally(() => {
      reading = false
      if (active) {
        setLoading(false)
        if (pending) { pending = false; refreshInbox() }
      }
    })
    }
    refreshInboxRef.current = refreshInbox
    refreshInbox()
    const timer = window.setInterval(refreshInbox, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') refreshInbox() }
    document.addEventListener('visibilitychange', onVisible)
    const client = shouldUseLanApi(user) ? null : supabase
    const channel = client?.channel(uniqueChannelName(`message-inbox:${user.id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_messages', filter: `recipient_id=eq.${user.id}` }, refreshInbox)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_messages', filter: `sender_id=eq.${user.id}` }, refreshInbox)
      .subscribe()
    return () => {
      active = false
      refreshInboxRef.current = null
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      if (client && channel) void client.removeChannel(channel)
    }
  }, [user.id, user.authToken])

  useEffect(() => {
    let active = true
    let reading = false
    let initializeHistory = historyContactRef.current !== contactId
    historyContactRef.current = contactId
    if (initializeHistory) {
      setMessages([])
      setHasOlder(false)
    }
    if (!contact || shouldUseLanApi(user) || !supabase) return
    const refresh = () => {
      if (reading) return
      reading = true
      void fetchMessageHistory(user, contactId).then(async (rows) => {
        if (!active) return
        setMessages((current) => {
          const combined = new Map(current.map((message) => [message.id, message]))
          rows.forEach((message) => combined.set(message.id, message))
          return Array.from(combined.values()).sort(compareMessages)
        })
        if (initializeHistory) {
          setHasOlder(rows.length === 50)
          initializeHistory = false
        }
        if (document.visibilityState === 'visible' && rows.some((message) => message.recipient_id === user.id && !message.read_at)) {
          await markMessagesRead(user, contactId)
          refreshInboxRef.current?.()
        }
      }).catch((reason) => { if (active) setError(reason.message) }).finally(() => { reading = false })
    }
    refresh()
    const timer = window.setInterval(refresh, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    const client = supabase
    const channel = client.channel(uniqueChannelName(`employee-messages:${user.id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_messages', filter: `recipient_id=eq.${user.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_messages', filter: `sender_id=eq.${user.id}` }, refresh)
      .subscribe()
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      void client.removeChannel(channel)
    }
  }, [user.id, contactId, reload])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [messages.at(-1)?.id])

  function chooseContact(id: string) {
    setContactId(id)
    setDraft('')
    setError('')
    setFeedback('')
  }

  async function loadOlder() {
    if (!contact || !messages[0] || olderLoading) return
    const id = contactId
    setOlderLoading(true)
    try {
      const rows = await fetchMessageHistory(user, id, messages[0].id)
      if (conversationRef.current !== id) return
      setMessages((current) => Array.from(new Map([...rows, ...current].map((message) => [message.id, message])).values()).sort(compareMessages))
      setHasOlder(rows.length === 50)
    } catch (reason) { setError((reason as Error).message) }
    finally { setOlderLoading(false) }
  }

  async function send() {
    if (sending || (!contact && !broadcast) || !draft.trim()) return
    if (broadcast && !window.confirm(`Gửi tin nhắn này cho tất cả ${contacts.length} nhân viên?`)) return
    setSending(true)
    setError('')
    setFeedback('')
    try {
      const count = await sendEmployeeMessage(user, broadcast ? null : contact!, draft)
      refreshInboxRef.current?.()
      setDraft('')
      if (broadcast) setFeedback(`Đã gửi tin nhắn cho ${count} nhân viên.`)
      else setReload((current) => current + 1)
    } catch (reason) { setError((reason as Error).message) }
    finally { setSending(false) }
  }

  return <section className="messages-page">
    <header className="messages-heading"><h1>Tin nhắn</h1><p>{user.role === 'admin' ? 'Trò chuyện với nhân viên hoặc gửi thông báo cho tất cả.' : 'Trao đổi trực tiếp với Admin hệ thống.'}</p></header>
    <div className="messages-workspace">
      <aside className="messages-contacts">
        <input type="search" placeholder={user.role === 'admin' ? 'Tìm nhân viên' : 'Tìm Admin'} aria-label="Tìm người trò chuyện" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="messages-mobile-contact">Người nhận<select value={contactId} disabled={sending || loading} onChange={(event) => chooseContact(event.target.value)}>
          {!contactId && <option value="">Chọn người nhận</option>}
          {user.role === 'admin' && contacts.length > 0 && <option value="*">Tất cả nhân viên</option>}
          {contacts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        <div className="messages-contact-list">
          {loading && <p>Đang tải danh sách…</p>}
          {user.role === 'admin' && contacts.length > 0 && <button type="button" className={broadcast ? 'active' : ''} disabled={sending} onClick={() => chooseContact('*')}>Tất cả nhân viên<small>Gửi thông báo chung</small></button>}
          {visibleContacts.map((item) => <button type="button" key={item.id} className={`${contactId === item.id ? 'active' : ''}${item.unread_count ? ' unread' : ''}`} disabled={sending} onClick={() => chooseContact(item.id)}>
            <span className="messages-contact-title"><strong>{item.name}</strong>{Boolean(item.unread_count) && <b className="messages-unread-count" aria-label={`${item.unread_count} tin chưa đọc`}>{Number(item.unread_count) > 99 ? '99+' : item.unread_count}</b>}</span>
            <small className="messages-contact-preview">{item.latest_message ? `${item.latest_sender_id === user.id ? 'Bạn: ' : ''}${item.latest_message}` : 'Chưa có tin nhắn'}</small>
            {item.latest_at && <time className="messages-contact-time" dateTime={item.latest_at}>{formatTime(item.latest_at)}</time>}
          </button>)}
          {!loading && !visibleContacts.length && <p>Không có người nhận phù hợp.</p>}
        </div>
      </aside>
      <article className="messages-conversation">
        <header><strong>{broadcast ? 'Tất cả nhân viên' : contact?.name || 'Chọn người trò chuyện'}</strong></header>
        <div className="messages-history" aria-label="Lịch sử tin nhắn">
          {broadcast ? <p className="empty-copy">Tin nhắn được gửi vào cuộc trò chuyện riêng của từng nhân viên với bạn.</p> : <>
            {hasOlder && <button type="button" className="secondary-button messages-load-older" disabled={olderLoading} onClick={() => void loadOlder()}>{olderLoading ? 'Đang tải…' : 'Xem tin nhắn trước'}</button>}
            {!messages.length && <p className="empty-copy">{contact ? 'Chưa có tin nhắn. Bắt đầu cuộc trò chuyện bên dưới.' : 'Chọn người nhận để bắt đầu.'}</p>}
            {messages.map((message) => <div key={message.id} className={`message-bubble${message.sender_id === user.id ? ' own' : ''}`}><p>{message.body}</p><small>{formatTime(message.created_at)}</small></div>)}
            <div ref={endRef} />
          </>}
        </div>
        <form className="messages-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
          {error && <p className="error-banner" role="alert">{error}</p>}
          {feedback && <p className="success-banner" role="status">{feedback}</p>}
          <label className="messages-draft-label">Tin nhắn<textarea value={draft} maxLength={2000} disabled={sending || (!contact && !broadcast)} onChange={(event) => setDraft(event.target.value)} placeholder="Nhập tin nhắn…" /></label>
          <button type="submit" className="primary-button" disabled={sending || !draft.trim() || (!contact && !broadcast)}>{sending ? 'Đang gửi…' : 'Gửi tin nhắn'}</button>
        </form>
      </article>
    </div>
  </section>
}

function compareMessages(a: EmployeeMessage, b: EmployeeMessage) { return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id) }
function formatTime(value: string) { return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
