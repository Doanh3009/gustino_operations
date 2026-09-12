import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser, Role } from '../types'

export interface MessageContact {
  id: string; name: string; role: Role; branch_id: string | null
  latest_message?: string | null; latest_at?: string | null; latest_sender_id?: string | null; unread_count?: number
}
export interface EmployeeMessage { id: string; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null }

function clientFor(user: AppUser) {
  if (shouldUseLanApi(user) || !supabase) throw new Error('Tin nhắn cần tài khoản đăng nhập Supabase; môi trường LAN chưa hỗ trợ.')
  return supabase
}

function fail(error: { code?: string; message?: string }): never {
  if (['PGRST202', 'PGRST205', '42P01'].includes(error.code || '')) throw new Error('Chưa cài SQL tin nhắn trên Supabase.')
  throw new Error(error.message || 'Không thể xử lý tin nhắn.')
}

export async function fetchMessageContacts(user: AppUser): Promise<MessageContact[]> {
  const { data, error } = await clientFor(user).rpc('messaging_inbox')
  if (error) fail(error)
  return data || []
}

export async function fetchMessageHistory(user: AppUser, contactId: string, beforeId?: string): Promise<EmployeeMessage[]> {
  const { data, error } = await clientFor(user).rpc('messaging_history', { p_contact_id: contactId, p_before_id: beforeId || null })
  if (error) fail(error)
  return data || []
}

export async function sendEmployeeMessage(user: AppUser, contact: MessageContact | null, body: string): Promise<number> {
  const text = body.trim()
  if (!text || Array.from(text).length > 2000) throw new Error('Tin nhắn phải có từ 1 đến 2000 ký tự.')
  if (!contact && user.role !== 'admin') throw new Error('Chỉ Admin được gửi cho tất cả nhân viên.')
  if (contact && (contact.id === user.id || (user.role === 'admin' ? contact.role === 'admin' : contact.role !== 'admin'))) throw new Error('Nhân viên chỉ được nhắn cho Admin.')
  const { data, error } = await clientFor(user).rpc('send_employee_message', { p_recipient_id: contact?.id || null, p_body: text })
  if (error) fail(error)
  return Number(data || 0)
}

export async function markMessagesRead(user: AppUser, contactId: string) {
  const { error } = await clientFor(user).rpc('mark_employee_messages_read', { p_contact_id: contactId })
  if (error) fail(error)
}
