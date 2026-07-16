import { supabase } from './supabase'
import type { ActiveUserSession, AppUser } from '../types'

export async function heartbeatActiveUser(user: AppUser, page: string) {
  const session: ActiveUserSession = {
    userId: user.id,
    userName: user.name,
    role: user.role,
    branchId: user.branchId,
    page,
    lastSeenAt: new Date().toISOString(),
  }
  if (!supabase) throw new Error('Không thể đồng bộ trạng thái online vì chưa kết nối máy chủ dữ liệu.')
  const { error } = await supabase.from('active_user_sessions').upsert({
    user_id: session.userId,
    user_name: session.userName,
    role: session.role,
    branch_id: session.branchId || null,
    page: session.page,
    last_seen_at: session.lastSeenAt,
  }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function fetchActiveUsers(_user: AppUser, onlineWindowMs = 2 * 60 * 1000) {
  const cutoff = new Date(Date.now() - onlineWindowMs).toISOString()
  if (!supabase) throw new Error('Không thể tải người dùng online vì chưa kết nối máy chủ dữ liệu.')
  const { data, error } = await supabase
    .from('active_user_sessions')
    .select('*')
    .gte('last_seen_at', cutoff)
    .order('last_seen_at', { ascending: false })
  if (error) throw error
  return (data || []).map((row: any) => ({
    userId: row.user_id,
    userName: row.user_name,
    role: row.role,
    branchId: row.branch_id || '',
    page: row.page || '',
    lastSeenAt: row.last_seen_at,
  })) as ActiveUserSession[]
}
