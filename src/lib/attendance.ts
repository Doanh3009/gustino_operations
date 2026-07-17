import { createId, decodeImageForCanvas } from './browser'
import { branchIds, branchName } from './branches'
import { localDateKey, localDayBoundsIso } from './dates'
import { shouldUseLanApi, supabase } from './supabase'
import { usernameToEmail, validateUsername } from './authIdentity'
import { formatWorkDurationBetween } from './workDuration'
import type {
  AppUser,
  AttendanceRecord,
  AttendanceReportRow,
  Branch,
  EmployeeProfile,
  EmploymentType,
  Role,
  ScheduleEntry,
  SchedulePerson,
  ShiftRegistration,
  WorkShift,
} from '../types'

interface AttendanceFilters {
  branchId?: string
  userId?: string
  from?: string
  to?: string
}

export const DEFAULT_WORK_SHIFT_TEMPLATES: Array<Pick<WorkShift, 'name' | 'startTime' | 'endTime' | 'employmentTypes'>> = [
  { name: 'Ca 1', startTime: '07:15', endTime: '15:15', employmentTypes: ['leader', 'full_time'] },
  { name: 'Ca 2', startTime: '14:15', endTime: '22:15', employmentTypes: ['leader', 'full_time'] },
  { name: 'Ca PT sáng', startTime: '09:00', endTime: '13:00', employmentTypes: ['part_time'] },
  { name: 'Ca PT chiều', startTime: '16:00', endTime: '21:00', employmentTypes: ['part_time'] },
]

export function canManageShiftSetup(user: AppUser) {
  return user.role === 'admin' || user.role === 'manager' || user.role === 'shift_leader'
}

function authHeaders(user: AppUser) {
  return {
    'Content-Type': 'application/json',
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
    'X-User-Id': user.id,
    'X-User-Role': user.role,
    'X-User-Branch': user.branchId,
    'X-User-Branches': (user.branchIds || [user.branchId]).join(','),
  }
}

async function attendanceApi<T>(user: AppUser, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/attendance${path}`, {
    ...init,
    headers: { ...authHeaders(user), ...(init?.headers || {}) },
  })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('Máy chủ chấm công chưa hoạt động. Hãy khởi động lại ứng dụng bằng lệnh npm run dev.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Không thể xử lý dữ liệu chấm công.')
  }
  return response.json() as Promise<T>
}

function shouldUseAttendanceApi(user: AppUser) {
  return shouldUseLanApi(user)
}

function queryString(filters: AttendanceFilters) {
  const params = new URLSearchParams()
  if (filters.branchId) params.set('branchId', filters.branchId)
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  return params.toString()
}

export function permittedBranchIds(user: AppUser) {
  if (user.role === 'admin') return branchIds()
  if (user.role === 'manager' || user.role === 'kitchen') {
    const scopedIds = Array.from(new Set([user.branchId, ...(user.branchIds || [])].filter(Boolean)))
    return scopedIds.length ? scopedIds : branchIds()
  }
  const scopedIds = Array.from(new Set([user.branchId, ...(user.branchIds || [])].filter(Boolean)))
  return scopedIds.length ? scopedIds : branchIds()
}

async function activeBranchIdSet() {
  if (!supabase) return new Set(branchIds())
  const { data, error } = await supabase.from('branches').select('id').eq('active', true)
  if (error) {
    console.warn('Falling back to cached active branches:', error.message)
    return new Set(branchIds())
  }
  return new Set((data || []).map((row: { id: string }) => row.id))
}

function isActiveBranch(branchId: string | undefined, activeBranches: Set<string>) {
  return Boolean(branchId && activeBranches.has(branchId))
}

export async function fetchWorkShifts(user: AppUser): Promise<WorkShift[]> {
  if (shouldUseAttendanceApi(user)) return attendanceApi(user, '/shifts')
  const activeBranches = await activeBranchIdSet()
  const { data, error } = await supabase!.from('shifts').select('*').eq('active', true).order('start_time')
  if (error) throw error
  return (data || []).filter((row) => isActiveBranch(row.branch_id, activeBranches)).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    graceMinutes: row.grace_minutes,
    recommendedStaff: row.recommended_staff || 3,
    employmentTypes: row.employment_types || undefined,
    active: row.active,
  }))
}

export async function fetchEmployees(user: AppUser, options: { includeInactive?: boolean } = {}): Promise<EmployeeProfile[]> {
  if (shouldUseAttendanceApi(user)) return attendanceApi(user, '/employees')
  const branches = permittedBranchIds(user)
  const activeBranches = await activeBranchIdSet()
  const client = supabase!
  let query = client.from('profiles').select('id, full_name, email, role, branch_id, active, employment_type, position_title, avatar_url').order('full_name')
  if (!options.includeInactive) query = query.eq('active', true)
  if (user.role !== 'admin') query = query.in('branch_id', branches)
  let { data, error } = await query as { data: any[] | null; error: any }
  if (error) throw error
  const rows = options.includeInactive
    ? (data || [])
    : (data || []).filter((row) => row.role === 'admin' || row.role === 'manager' || row.role === 'kitchen' || isActiveBranch(row.branch_id, activeBranches))
  return rows.map((row) => ({
    id: row.id,
    name: row.full_name,
    email: row.email || undefined,
    role: row.role,
    branchId: row.branch_id || undefined,
    active: row.active !== false,
    hasLoginAccount: Boolean(row.email),
    employmentType: row.employment_type || undefined,
    positionTitle: row.position_title || undefined,
    avatarUrl: row.avatar_url || undefined,
  }))
}

export async function fetchSchedulePeople(user: AppUser): Promise<SchedulePerson[]> {
  if (!supabase) {
    return (await fetchEmployees(user)).map((employee, index) => ({
      id: employee.id,
      profileId: employee.id,
      name: employee.name,
      branchId: employee.branchId || user.branchId,
      active: employee.active !== false,
      employmentType: employee.employmentType,
      positionTitle: employee.positionTitle,
      sortOrder: index,
    }))
  }
  const { data, error } = await supabase.rpc('list_schedule_people')
  if (error) {
    console.warn('Falling back to profiles for schedule people:', error.message)
    return (await fetchEmployees(user)).map((employee, index) => ({
      id: employee.id,
      profileId: employee.id,
      name: employee.name,
      branchId: employee.branchId || user.branchId,
      active: employee.active !== false,
      employmentType: employee.employmentType,
      positionTitle: employee.positionTitle,
      sortOrder: index,
    }))
  }
  const activeProfileIds = new Set((await fetchEmployees(user).catch(() => [] as EmployeeProfile[])).map((employee) => employee.id))
  const canTrustProfileFilter = (user.role === 'admin' || user.role === 'manager') && activeProfileIds.size > 0
  const activeBranches = await activeBranchIdSet()
  return (data || [])
    .map((row: any, index: number) => ({
    id: row.id,
    profileId: row.profile_id || (row.role ? row.id : undefined),
    name: row.full_name,
    branchId: row.branch_id,
    active: row.active !== false,
    employmentType: row.employment_type || undefined,
    positionTitle: row.position_title || undefined,
    sortOrder: Number(row.sort_order ?? index),
    }))
    .filter((person: SchedulePerson) =>
      person.active !== false
      && isActiveBranch(person.branchId, activeBranches)
      && (!person.profileId || !canTrustProfileFilter || activeProfileIds.has(person.profileId)),
    )
}

export async function fetchScheduleEntries(
  user: AppUser,
  filters: { branchId: string; from: string; to: string },
): Promise<ScheduleEntry[]> {
  if (shouldUseAttendanceApi(user)) return []
  const { data, error } = await supabase!
    .from('schedule_entries')
    .select('*')
    .eq('branch_id', filters.branchId)
    .gte('work_date', filters.from)
    .lte('work_date', filters.to)
    .order('work_date')
  if (error) {
    console.warn('Schedule entries unavailable, using registrations as fallback:', error.message)
    return []
  }
  return (data || []).map((row) => ({
    id: row.id,
    personId: row.person_id,
    branchId: row.branch_id,
    workDate: row.work_date,
    shiftId: row.shift_id || undefined,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    note: row.note || '',
  }))
}

export async function createSchedulePerson(
  user: AppUser,
  input: Pick<SchedulePerson, 'name' | 'branchId' | 'employmentType' | 'positionTitle'>,
) {
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Chỉ Quản lý được thêm nhân sự vào bảng lịch.')
  if (!supabase) throw new Error('Cần kết nối Supabase để quản lý bảng lịch.')
  const { error } = await supabase.from('schedule_people').insert({
    full_name: input.name.trim(),
    branch_id: input.branchId,
    employment_type: input.employmentType || 'part_time',
    position_title: input.positionTitle?.trim() || 'Part-time',
  })
  if (error) throw error
}

export async function deleteSchedulePerson(user: AppUser, personId: string) {
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Chỉ Quản lý được xóa dòng nhân sự.')
  if (!supabase) throw new Error('Cần kết nối Supabase để quản lý bảng lịch.')
  const { error } = await supabase.from('schedule_people').update({ active: false }).eq('id', personId)
  if (error) throw error
}

export async function setScheduleEntry(
  user: AppUser,
  input: { personId: string; branchId: string; workDate: string; shiftId?: string },
) {
  if (!supabase) throw new Error('Cần kết nối Supabase để cập nhật bảng lịch.')
  const { error } = await supabase.rpc('set_schedule_entry', {
    p_person_id: input.personId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_shift_id: input.shiftId || null,
  })
  if (error) throw error
}

export async function createWorkShift(
  user: AppUser,
  input: Pick<WorkShift, 'branchId' | 'name' | 'startTime' | 'endTime' | 'employmentTypes'>,
) {
  if (!canManageShiftSetup(user)) throw new Error('Bạn không có quyền tạo khung ca.')
  const name = (input.name || `${input.startTime}-${input.endTime}`).trim()
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<WorkShift>(user, '/shifts', {
      method: 'POST',
      body: JSON.stringify({ ...input, name }),
    })
  }
  if (!supabase) throw new Error('Cần kết nối Supabase để tạo khung ca.')
  const safeCreated = await supabase.rpc('create_work_shift_safe', {
    p_branch_id: input.branchId,
    p_name: name,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_employment_types: input.employmentTypes || [],
  })
  if (!safeCreated.error) return mapWorkShift(safeCreated.data)
  if (!isMissingRpcError(safeCreated.error)) throw friendlyShiftSetupError(safeCreated.error)

  const { error } = await supabase.from('shifts').upsert({
    branch_id: input.branchId,
    name,
    start_time: input.startTime,
    end_time: input.endTime,
    grace_minutes: 5,
    recommended_staff: 3,
    employment_types: input.employmentTypes || [],
    active: true,
    created_by: user.id,
  }, { onConflict: 'branch_id,name' })
  if (error) {
    if (/foreign key|violates foreign key|branches/i.test(error.message)) {
      throw new Error('Chi nhánh này chưa được đồng bộ lên Supabase. Hãy lưu chi nhánh trong Trung tâm quản trị rồi thử lại.')
    }
    throw error
  }
}

export async function syncBranchToCloud(user: AppUser, branch: { id: string; name: string }) {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được đồng bộ chi nhánh.')
  if (!supabase) return
  const { error } = await supabase.rpc('upsert_config_branch', {
    p_branch_id: branch.id,
    p_branch_name: branch.name,
  })
  if (!error) return
  if (!isMissingRpcError(error)) throw error
  const { error: directError } = await supabase.from('branches').upsert({
    id: branch.id,
    name: branch.name,
    active: true,
  }, { onConflict: 'id' })
  if (directError) throw directError
}

export async function ensureDefaultWorkShifts(user: AppUser, branch: Branch): Promise<WorkShift[]> {
  if (!canManageShiftSetup(user)) throw new Error('Bạn không có quyền thiết lập khung ca.')
  if (user.role === 'admin') await syncBranchToCloud(user, branch)
  const current = await fetchWorkShifts(user)
  const existing = current.filter((shift) => shift.branchId === branch.id && shift.active !== false)
  if (existing.length) return existing
  for (const template of DEFAULT_WORK_SHIFT_TEMPLATES) {
    await createWorkShift(user, {
      branchId: branch.id,
      name: template.name,
      startTime: template.startTime,
      endTime: template.endTime,
      employmentTypes: template.employmentTypes,
    })
  }
  return (await fetchWorkShifts(user)).filter((shift) => shift.branchId === branch.id && shift.active !== false)
}

export async function archiveWorkShift(user: AppUser, shiftId: string) {
  if (!canManageShiftSetup(user)) throw new Error('Bạn không có quyền xóa khung ca.')
  if (shiftId.startsWith('fallback-shift:')) {
    throw new Error('Đây là khung ca mặc định tạm thời. Hãy tạo khung ca thật trên Supabase rồi thử lại.')
  }
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/shifts/${shiftId}`, { method: 'DELETE' })
    return
  }
  if (!supabase) throw new Error('Cần kết nối Supabase để xóa khung ca.')
  const archived = await supabase.rpc('archive_work_shift_safe', { p_shift_id: shiftId })
  if (!archived.error) return
  if (!isMissingRpcError(archived.error)) throw friendlyShiftSetupError(archived.error)

  const { data, error } = await supabase
    .from('shifts')
    .update({ active: false })
    .eq('id', shiftId)
    .select('id')
    .maybeSingle()
  if (error) throw friendlyShiftSetupError(error)
  if (!data) throw new Error('Chưa xóa được ca. Tài khoản hiện tại chưa có quyền trên Supabase hoặc migration xóa ca chưa được chạy.')
}

export interface CreateEmployeeAccountInput {
  name: string
  username: string
  branchId?: string
  role: Exclude<Role, 'admin'>
  employmentType: EmploymentType
  positionTitle: string
  password: string
}

export async function createEmployeeAccount(user: AppUser, input: CreateEmployeeAccountInput): Promise<EmployeeProfile> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được tạo tài khoản nhân viên.')
  const username = validateUsername(input.username)
  if (input.password.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.')
  const payload = {
    ...input,
    username,
    email: usernameToEmail(username),
    temporaryPassword: input.password,
    branchName: input.branchId ? branchName(input.branchId) : undefined,
  }
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<EmployeeProfile>(user, '/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }
  const data = await invokeManageEmployee({ action: 'create', ...payload })
  return data.employee as EmployeeProfile
}

export async function resetEmployeePassword(user: AppUser, employeeId: string, temporaryPassword: string): Promise<void> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được đặt lại mật khẩu.')
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/employees/${employeeId}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ temporaryPassword }),
    })
    return
  }
  await invokeManageEmployee({ action: 'reset_password', employeeId, password: temporaryPassword })
}

export async function deleteEmployeeAccount(user: AppUser, employeeId: string): Promise<void> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được xóa tài khoản.')
  if (employeeId === user.id) throw new Error('Bạn không thể xóa tài khoản đang đăng nhập.')
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/employees/${employeeId}?hard=1`, { method: 'DELETE' })
    return
  }
  await invokeManageEmployee({ action: 'hard_delete', employeeId })
}

export async function hardDeleteEmployeeAccount(user: AppUser, employeeId: string): Promise<void> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được xóa sạch dữ liệu test.')
  if (employeeId === user.id) throw new Error('Bạn không thể xóa sạch tài khoản đang đăng nhập.')
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/employees/${employeeId}?hard=1`, { method: 'DELETE' })
    return
  }
  await invokeManageEmployee({ action: 'hard_delete', employeeId })
}

async function invokeManageEmployee(body: Record<string, unknown>): Promise<any> {
  if (!supabase) throw new Error('Supabase chưa được cấu hình.')
  const client = supabase
  const invoke = async (accessToken: string) => client.functions.invoke('manage-employee', {
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  })
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Không tìm thấy phiên Supabase. Hãy tải lại trang và thử lại.')
  }

  let result = await invoke(sessionData.session.access_token)
  if ((result.error as { context?: Response } | null)?.context?.status === 401) {
    const { data: refreshed, error: refreshError } = await client.auth.refreshSession()
    if (!refreshError && refreshed.session?.access_token) {
      result = await invoke(refreshed.session.access_token)
    }
  }
  if (result.error) {
    const context = (result.error as { context?: Response }).context
    const payload = context
      ? await context.clone().json().catch(() => null) as { error?: string } | null
      : null
    if (context?.status === 401) {
      throw new Error('Supabase chưa xác nhận được phiên Admin. Hãy bấm lại thao tác, không cần đăng nhập lại.')
    }
    throw new Error(payload?.error || result.error.message || 'Không thể quản lý tài khoản.')
  }
  if (result.data?.error) throw new Error(result.data.error)
  return result.data
}

export async function updateEmployeeRole(user: AppUser, employeeId: string, role: Role): Promise<void> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được thay đổi phân quyền.')
  if (role === 'admin' && employeeId !== user.id) throw new Error('Không cấp quyền Admin từ màn nhân sự thường.')
  if (employeeId === user.id && role !== 'admin') throw new Error('Bạn không thể tự hạ quyền Admin của chính mình.')
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
    return
  }
  const { error } = await supabase!.rpc('admin_update_profile_role', {
    p_profile_id: employeeId,
    p_role: role,
  })
  if (error) throw error
}

export async function updateEmployeeDetails(
  user: AppUser,
  employeeId: string,
  patch: {
    name?: string
    branchId?: string
    role?: Exclude<Role, 'admin'>
    employmentType?: EmploymentType
    positionTitle?: string
    avatarUrl?: string
  },
): Promise<EmployeeProfile> {
  if (user.role !== 'admin') throw new Error('Chỉ Admin hệ thống được chỉnh sửa hồ sơ nhân viên.')
  if (employeeId === user.id && patch.role) {
    throw new Error('Bạn không thể tự hạ quyền Admin của chính mình.')
  }
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<EmployeeProfile>(user, `/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }
  const data = await invokeManageEmployee({
    action: 'update',
    employeeId,
    ...patch,
    branchName: patch.branchId ? branchName(patch.branchId) : undefined,
  })
  return data.employee as EmployeeProfile
}

export async function fetchShiftRegistrations(user: AppUser, filters: AttendanceFilters = {}): Promise<ShiftRegistration[]> {
  if (shouldUseAttendanceApi(user)) return attendanceApi(user, `/registrations?${queryString(filters)}`)
  const activeBranches = await activeBranchIdSet()
  let query = supabase!
    .from('shift_registrations')
    .select('*, profiles!shift_registrations_user_id_fkey(full_name, active, employment_type, position_title)')
    .order('work_date', { ascending: false })
    .order('start_time')
  if (filters.branchId) query = query.eq('branch_id', filters.branchId)
  if (filters.userId) query = query.eq('user_id', filters.userId)
  if (filters.from) query = query.gte('work_date', filters.from)
  if (filters.to) query = query.lte('work_date', filters.to)
  const { data, error } = await query
  if (error) throw error
  return (data || [])
    .filter((row) => row.profiles?.active !== false && isActiveBranch(row.branch_id, activeBranches))
    .map(mapRegistration)
}

export async function createShiftRegistration(
  user: AppUser,
  input: Pick<ShiftRegistration, 'branchId' | 'workDate' | 'startTime' | 'endTime' | 'shiftId' | 'note'>,
) {
  validateRegistration(input)
  const registration: ShiftRegistration = {
    id: createId(),
    userId: user.id,
    userName: user.name,
    employmentType: user.employmentType,
    positionTitle: user.positionTitle,
    branchId: input.branchId,
    workDate: input.workDate,
    startTime: input.startTime,
    endTime: input.endTime,
    shiftId: input.shiftId,
    status: 'approved',
    note: input.note.trim(),
    createdAt: new Date().toISOString(),
  }
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, '/registrations', { method: 'POST', body: JSON.stringify(registration) })
    return registration
  }
  const safeRpc = await supabase!.rpc('add_shift_registration_safe', {
    p_user_id: registration.userId,
    p_branch_id: registration.branchId,
    p_work_date: registration.workDate,
    p_shift_id: registration.shiftId || null,
    p_start_time: registration.startTime,
    p_end_time: registration.endTime,
    p_note: registration.note,
  })
  if (!safeRpc.error && safeRpc.data) {
    return {
      ...mapRegistration({ ...safeRpc.data, profiles: { full_name: user.name } }),
      userName: user.name,
      employmentType: user.employmentType,
      positionTitle: user.positionTitle,
    }
  }
  if (safeRpc.error && !isMissingRpcError(safeRpc.error)) throw friendlyRegistrationError(safeRpc.error)

  const manualRpc = await supabase!.rpc('add_manual_shift_registration', {
    p_user_id: registration.userId,
    p_branch_id: registration.branchId,
    p_work_date: registration.workDate,
    p_start_time: registration.startTime,
    p_end_time: registration.endTime,
    p_note: registration.note,
  })
  if (!manualRpc.error && manualRpc.data) {
    return {
      ...mapRegistration({ ...manualRpc.data, profiles: { full_name: user.name } }),
      userName: user.name,
      employmentType: user.employmentType,
      positionTitle: user.positionTitle,
      shiftId: registration.shiftId,
    }
  }
  if (manualRpc.error && !isMissingRpcError(manualRpc.error)) throw friendlyRegistrationError(manualRpc.error)

  const { error } = await supabase!.from('shift_registrations').insert({
    id: registration.id,
    user_id: registration.userId,
    branch_id: registration.branchId,
    shift_id: registration.shiftId || null,
    work_date: registration.workDate,
    start_time: registration.startTime,
    end_time: registration.endTime,
    status: 'approved',
    note: registration.note,
    employment_type: registration.employmentType || null,
    position_title: registration.positionTitle || null,
  })
  if (error) throw friendlyRegistrationError(error)
  return registration
}

export async function createManualShiftRegistration(
  actor: AppUser,
  input: {
    userId: string
    userName: string
    branchId: string
    workDate: string
    startTime: string
    endTime: string
    note: string
    employmentType?: EmploymentType
    positionTitle?: string
  },
) {
  validateRegistration(input)
  const managesBranch = canManageShiftSetup(actor) && permittedBranchIds(actor).includes(input.branchId)
  const canEdit = input.userId === actor.id || managesBranch
  if (!canEdit) throw new Error('Bạn chỉ được thêm ca cho chính mình.')
  if (!managesBranch && input.workDate < localDateKey()) {
    throw new Error('Không thể thêm ca cho ngày đã qua.')
  }
  const registration: ShiftRegistration = {
    id: createId(),
    userId: input.userId,
    userName: input.userName,
    employmentType: input.employmentType,
    positionTitle: input.positionTitle,
    branchId: input.branchId,
    workDate: input.workDate,
    startTime: input.startTime,
    endTime: input.endTime,
    status: 'approved',
    note: input.note.trim(),
    createdAt: new Date().toISOString(),
  }
  if (shouldUseAttendanceApi(actor)) {
    if (input.userId !== actor.id && !managesBranch) throw new Error('Máy chủ local chỉ hỗ trợ nhân viên tự thêm ca của mình.')
    await attendanceApi(actor, '/registrations', { method: 'POST', body: JSON.stringify(registration) })
    return registration
  }
  const result = await supabase!.rpc('add_manual_shift_registration', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_note: registration.note,
  })
  if (!result.error && result.data) return { ...registration, id: result.data.id || registration.id, createdAt: result.data.created_at || registration.createdAt }
  if (input.userId !== actor.id) {
    throw new Error(result.error?.message || 'Cần cập nhật Supabase để quản lý thêm ca cho nhân viên.')
  }
  const { error } = await supabase!.from('shift_registrations').insert({
    id: registration.id,
    user_id: registration.userId,
    branch_id: registration.branchId,
    shift_id: null,
    work_date: registration.workDate,
    start_time: registration.startTime,
    end_time: registration.endTime,
    status: 'approved',
    note: registration.note,
    employment_type: registration.employmentType || null,
    position_title: registration.positionTitle || null,
  })
  if (error) throw error
  return registration
}

export async function createAttendanceSupplement(
  actor: AppUser,
  input: {
    userId: string
    branchId: string
    workDate: string
    startTime: string
    endTime: string
    reason: string
  },
) {
  if (actor.role !== 'admin') throw new Error('Chỉ Admin hệ thống được bổ sung công cho nhân viên.')
  validateRegistration({
    branchId: input.branchId,
    workDate: input.workDate,
    startTime: input.startTime,
    endTime: input.endTime,
  })
  const supplementalCheckOut = localDateTime(
    input.workDate,
    input.endTime,
    input.endTime <= input.startTime,
  )
  if (supplementalCheckOut.getTime() > Date.now()) {
    throw new Error('Chỉ được bổ sung công sau khi ca đã kết thúc. Ca đang hoặc chưa diễn ra phải chấm công bình thường.')
  }
  if (shouldUseAttendanceApi(actor)) {
    throw new Error('Bổ sung công chỉ thực hiện trên hệ thống online để đảm bảo đồng bộ dữ liệu.')
  }
  const { data, error } = await supabase!.rpc('admin_add_attendance_supplement', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_reason: input.reason.trim(),
  })
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Chưa cập nhật chức năng bổ sung công trên Supabase. Cần chạy migration mới rồi thử lại.')
    }
    throw new Error(error.message || 'Không thể bổ sung công cho nhân viên.')
  }
  window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  return data
}

export async function updateAttendanceRecordByAdmin(
  actor: AppUser,
  input: {
    recordId: string
    checkInTime: string
    checkOutTime: string
    reason: string
  },
) {
  if (actor.role !== 'admin') throw new Error('Chỉ Admin hệ thống được chỉnh công cho nhân viên.')
  const checkIn = new Date(input.checkInTime)
  const checkOut = new Date(input.checkOutTime)
  if (!input.recordId || Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    throw new Error('Thiếu bản ghi, giờ vào hoặc giờ ra hợp lệ.')
  }
  if (checkOut <= checkIn) throw new Error('Giờ ra phải sau giờ vào.')
  if (checkOut.getTime() - checkIn.getTime() > 18 * 60 * 60 * 1000) {
    throw new Error('Một ca không được vượt quá 18 giờ.')
  }
  if (checkOut.getTime() > Date.now()) throw new Error('Không được chỉnh giờ ra trong tương lai.')
  if (input.reason.trim().length < 3) throw new Error('Hãy nhập lý do điều chỉnh ít nhất 3 ký tự.')
  if (shouldUseAttendanceApi(actor)) {
    throw new Error('Chỉnh công chỉ thực hiện trên hệ thống online để đồng bộ với bảng lương.')
  }
  const { data, error } = await supabase!.rpc('admin_update_attendance_record', {
    p_record_id: input.recordId,
    p_check_in_time: checkIn.toISOString(),
    p_check_out_time: checkOut.toISOString(),
    p_reason: input.reason.trim(),
  })
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Chưa cập nhật chức năng chỉnh công trên Supabase. Cần chạy migration mới rồi thử lại.')
    }
    throw new Error(error.message || 'Không thể chỉnh công cho nhân viên.')
  }
  window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  return data
}

export async function deleteAttendanceRecordByAdmin(
  actor: AppUser,
  input: {
    recordId: string
    reason: string
  },
) {
  if (actor.role !== 'admin') throw new Error('Chỉ Admin hệ thống được xóa ca công của nhân viên.')
  if (!input.recordId) throw new Error('Thiếu bản ghi chấm công cần xóa.')
  if (input.reason.trim().length < 3) throw new Error('Hãy nhập lý do xóa ít nhất 3 ký tự.')
  if (shouldUseAttendanceApi(actor)) {
    throw new Error('Xóa ca công chỉ thực hiện trên hệ thống online để đồng bộ với bảng lương.')
  }
  const { data, error } = await supabase!.rpc('admin_delete_attendance_record', {
    p_record_id: input.recordId,
    p_reason: input.reason.trim(),
  })
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Chưa cập nhật chức năng xóa ca công trên Supabase. Cần chạy migration mới rồi thử lại.')
    }
    throw new Error(error.message || 'Không thể xóa ca công của nhân viên.')
  }
  window.dispatchEvent(new CustomEvent('gustino-attendance-updated'))
  return data
}

export async function setScheduleRegistration(
  user: AppUser,
  input: {
    userId: string
    userName: string
    branchId: string
    workDate: string
    shift?: WorkShift
    startTime?: string
    endTime?: string
    note?: string
    employmentType?: EmploymentType
    positionTitle?: string
  },
) {
  const managesBranch = canManageShiftSetup(user) && permittedBranchIds(user).includes(input.branchId)
  const canEdit = input.userId === user.id || managesBranch
  const startTime = input.shift?.startTime || input.startTime
  const endTime = input.shift?.endTime || input.endTime
  if (!canEdit) throw new Error('Bạn chỉ được chỉnh lịch của chính mình.')
  if (!input.shift && (input.startTime || input.endTime)) {
    validateRegistration({
      branchId: input.branchId,
      workDate: input.workDate,
      startTime: input.startTime || '',
      endTime: input.endTime || '',
    })
  }
  if (shouldUseAttendanceApi(user)) {
    return attendanceApi<ShiftRegistration | null>(user, '/registrations/cell', {
      method: 'PUT',
      body: JSON.stringify({
        ...input,
        shiftId: input.shift?.id,
        startTime,
        endTime,
      }),
    })
  }
  const safeCell = await supabase!.rpc('set_schedule_registration_safe', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_shift_id: input.shift?.id || null,
    p_start_time: !input.shift ? startTime || null : null,
    p_end_time: !input.shift ? endTime || null : null,
    p_note: input.note || '',
  })
  if (!safeCell.error) {
    return safeCell.data
      ? {
        ...mapRegistration({ ...safeCell.data, profiles: { full_name: input.userName } }),
        userName: input.userName,
        employmentType: input.employmentType,
        positionTitle: input.positionTitle,
      }
      : null
  }
  if (isMissingRpcError(safeCell.error)) {
    throw new Error('Chưa cập nhật migration set_schedule_registration_safe trên Supabase nên chưa thể sửa/xóa ca an toàn.')
  }
  throw friendlyRegistrationError(safeCell.error)

  const { data, error } = await supabase!.rpc('set_schedule_registration', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_shift_id: input.shift?.id || null,
  })
  if (error) {
    if (input.shift && isMissingRpcError(error)) {
      const safeRpc = await supabase!.rpc('add_shift_registration_safe', {
        p_user_id: input.userId,
        p_branch_id: input.branchId,
        p_work_date: input.workDate,
        p_shift_id: input.shift!.id,
        p_start_time: input.shift!.startTime,
        p_end_time: input.shift!.endTime,
        p_note: input.note || '',
      })
      if (!safeRpc.error && safeRpc.data) {
        return {
          ...mapRegistration({ ...safeRpc.data, profiles: { full_name: input.userName } }),
          userName: input.userName,
          employmentType: input.employmentType,
          positionTitle: input.positionTitle,
        }
      }
      throw friendlyRegistrationError(safeRpc.error || error)
    }
    throw friendlyRegistrationError(error)
  }
  if (!input.shift && input.startTime && input.endTime) {
    const custom = await supabase!.rpc('add_manual_shift_registration', {
      p_user_id: input.userId,
      p_branch_id: input.branchId,
      p_work_date: input.workDate,
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_note: input.note || 'Ca tự chọn',
    })
    if (custom.error) throw custom.error
    return custom.data
  }
  return data
}

export async function fetchAttendanceRecords(user: AppUser, filters: AttendanceFilters = {}): Promise<AttendanceRecord[]> {
  if (shouldUseAttendanceApi(user)) return attendanceApi(user, `/records?${queryString(filters)}`)
  const activeBranches = await activeBranchIdSet()
  let query = supabase!
    .from('attendance_records')
    .select('*, profiles!attendance_records_user_id_fkey(full_name, active)')
    .order('check_in_time', { ascending: false })
  if (user.role === 'staff') query = query.eq('user_id', user.id)
  if (filters.branchId) query = query.eq('branch_id', filters.branchId)
  if (filters.userId) query = query.eq('user_id', filters.userId)
  if (filters.from) query = query.gte('check_in_time', localDayBoundsIso(filters.from).startIso)
  if (filters.to) query = query.lte('check_in_time', localDayBoundsIso(filters.to).endIso)
  const { data, error } = await query
  if (error) throw error
  return (data || [])
    .filter((row) => row.profiles?.active !== false && isActiveBranch(row.branch_id, activeBranches))
    .map(mapAttendance)
}

export type AttendancePhase = 'locating' | 'saving'

export async function checkIn(user: AppUser, registration: ShiftRegistration, selfie: Blob, onPhase?: (phase: AttendancePhase) => void) {
  if (registration.userId !== user.id || registration.status === 'rejected') {
    throw new Error('Ca làm không hợp lệ hoặc không thuộc tài khoản này.')
  }
  onPhase?.('locating')
  const location = await getAttendanceLocation()
  const now = await getTrustedTimestamp()
  onPhase?.('saving')
  const stampedSelfie = await stampAttendancePhoto(selfie, {
    actionLabel: 'CHECK-IN',
    employeeName: user.name,
    branchName: branchName(registration.branchId) || registration.branchId,
    timestamp: now,
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
  })
  const selfiePreviewUrl = await blobToDataUrl(stampedSelfie)
  const selfieUrl = await uploadSelfie(user, registration, stampedSelfie)
  const record: AttendanceRecord = {
    id: createId(),
    userId: user.id,
    userName: user.name,
    branchId: registration.branchId,
    shiftRegistrationId: registration.id,
    checkInTime: now,
    selfieUrl,
    selfiePreviewUrl,
    checkInLatitude: location.latitude,
    checkInLongitude: location.longitude,
    checkInAccuracy: location.accuracy,
    checkInAddress: location.address,
    createdAt: now,
    updatedAt: now,
  }
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, '/records', { method: 'POST', body: JSON.stringify(record) })
    return record
  }
  const { error } = await supabase!.from('attendance_records').insert({
    id: record.id,
    user_id: record.userId,
    branch_id: record.branchId,
    shift_registration_id: record.shiftRegistrationId,
    check_in_time: record.checkInTime,
    selfie_url: record.selfieUrl,
    check_in_latitude: record.checkInLatitude,
    check_in_longitude: record.checkInLongitude,
    check_in_accuracy: record.checkInAccuracy,
    check_in_address: record.checkInAddress,
  })
  if (error) {
    if (String(error.code || '') === '23505' || /duplicate|already exists/i.test(error.message || '')) {
      const { data: existing } = await supabase!
        .from('attendance_records')
        .select('*, profiles!attendance_records_user_id_fkey(full_name, active)')
        .eq('shift_registration_id', registration.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (existing) return mapAttendance(existing)
    }
    throw error
  }
  return record
}

export async function checkOut(user: AppUser, record: AttendanceRecord, registration: ShiftRegistration, selfie: Blob, onPhase?: (phase: AttendancePhase) => void) {
  if (record.userId !== user.id || record.checkOutTime) throw new Error('Bản ghi này không thể check-out.')
  onPhase?.('locating')
  const location = await getAttendanceLocation()
  const checkOutTime = await getTrustedTimestamp()
  onPhase?.('saving')
  const stampedSelfie = await stampAttendancePhoto(selfie, {
    actionLabel: 'CHECK-OUT',
    employeeName: user.name,
    branchName: branchName(registration.branchId) || registration.branchId,
    timestamp: checkOutTime,
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    totalHoursLabel: record.checkInTime ? `Tổng giờ làm: ${formatWorkDurationBetween(record.checkInTime, checkOutTime)}` : undefined,
  })
  const checkOutSelfieUrl = await uploadSelfie(user, registration, stampedSelfie)
  if (shouldUseAttendanceApi(user)) {
    await attendanceApi(user, `/records/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        checkOutTime,
        updatedAt: checkOutTime,
        checkOutSelfieUrl,
        checkOutLatitude: location.latitude,
        checkOutLongitude: location.longitude,
        checkOutAccuracy: location.accuracy,
        checkOutAddress: location.address,
      }),
    })
    return
  }
  const { error } = await supabase!.from('attendance_records').update({
    check_out_time: checkOutTime,
    check_out_selfie_url: checkOutSelfieUrl,
    check_out_latitude: location.latitude,
    check_out_longitude: location.longitude,
    check_out_accuracy: location.accuracy,
    check_out_address: location.address,
    updated_at: checkOutTime,
  }).eq('id', record.id).eq('user_id', user.id).is('check_out_time', null)
  if (error) throw error
}

async function uploadSelfie(user: AppUser, registration: ShiftRegistration, selfie: Blob) {
  if (!selfie.size) throw new Error('Ảnh selfie là bắt buộc.')
  if (shouldUseAttendanceApi(user)) {
    const dataUrl = await blobToDataUrl(selfie)
    const result = await attendanceApi<{ url: string }>(user, '/selfies', {
      method: 'POST',
      body: JSON.stringify({ registrationId: registration.id, branchId: registration.branchId, dataUrl }),
    })
    return result.url
  }
  const path = `${user.id}/${registration.branchId}/${registration.id}-${Date.now()}.jpg`
  const { error } = await supabase!.storage.from('attendance-selfies').upload(path, selfie, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return path
}

export function buildAttendanceReport(
  registrations: ShiftRegistration[],
  records: AttendanceRecord[],
  graceMinutesByShift: Map<string, number>,
  now = new Date(),
): AttendanceReportRow[] {
  const groups = new Map<string, AttendanceReportRow>()
  const matchedRecordIds = new Set<string>()
  for (const registration of registrations.filter((item) => item.status !== 'rejected')) {
    const key = `${registration.userId}|${registration.branchId}`
    const row = groups.get(key) || {
      userId: registration.userId,
      employeeName: registration.userName,
      branchId: registration.branchId,
      totalShifts: 0,
      totalHours: 0,
      overtimeHours: 0,
      workDays: 0,
      lateCount: 0,
      absentCount: 0,
      missingCheckoutCount: 0,
    }
    const record = findAttendanceRecordForRegistration(records, registration)
    const scheduledStart = localDateTime(registration.workDate, registration.startTime)
    const scheduledEnd = localDateTime(registration.workDate, registration.endTime, registration.endTime <= registration.startTime)
    if (!record && now > scheduledEnd) row.absentCount += 1
    if (record) {
      matchedRecordIds.add(record.id)
      row.totalShifts += 1
      const checkIn = new Date(record.checkInTime)
      const grace = graceMinutesByShift.get(registration.shiftId || '') ?? 5
      if (checkIn.getTime() > scheduledStart.getTime() + grace * 60000) row.lateCount += 1
      if (record.checkOutTime) {
        const workedHours = Math.max(0, (new Date(record.checkOutTime).getTime() - checkIn.getTime()) / 3600000)
        row.totalHours += workedHours
        if (isOvertimeRegistration(registration)) row.overtimeHours += workedHours
        row.workDays += workDayCredit(workedHours, scheduledStart, scheduledEnd)
      } else if (now > scheduledEnd) {
        row.missingCheckoutCount += 1
      }
    }
    groups.set(key, row)
  }
  for (const record of records) {
    if (matchedRecordIds.has(record.id)) continue
    const key = `${record.userId}|${record.branchId}`
    const row = groups.get(key) || {
      userId: record.userId,
      employeeName: record.userName,
      branchId: record.branchId,
      totalShifts: 0,
      totalHours: 0,
      overtimeHours: 0,
      workDays: 0,
      lateCount: 0,
      absentCount: 0,
      missingCheckoutCount: 0,
    }
    row.totalShifts += 1
    if (record.checkOutTime) {
      const workedHours = Math.max(0, (new Date(record.checkOutTime).getTime() - new Date(record.checkInTime).getTime()) / 3600000)
      row.totalHours += workedHours
      row.workDays += orphanWorkDayCredit(workedHours)
    } else {
      row.missingCheckoutCount += 1
    }
    groups.set(key, row)
  }
  return Array.from(groups.values()).map((row) => ({
    ...row,
    totalHours: Number(row.totalHours.toFixed(2)),
    overtimeHours: Number(row.overtimeHours.toFixed(2)),
    workDays: Number(row.workDays.toFixed(2)),
  })).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'vi'))
}

export function validateRegistration(input: Pick<ShiftRegistration, 'branchId' | 'workDate' | 'startTime' | 'endTime'>) {
  if (!input.branchId || !input.workDate || !input.startTime || !input.endTime) throw new Error('Vui lòng nhập đủ ngày, giờ và chi nhánh.')
  const start = localDateTime(input.workDate, input.startTime)
  const end = localDateTime(input.workDate, input.endTime, input.endTime <= input.startTime)
  const hours = (end.getTime() - start.getTime()) / 3600000
  if (hours <= 0 || hours > 18) throw new Error('Thời lượng ca phải lớn hơn 0 và không quá 18 giờ.')
}

function mapRegistration(row: any): ShiftRegistration {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.profiles?.full_name || 'Nhân viên',
    employmentType: row.employment_type || row.profiles?.employment_type || undefined,
    positionTitle: row.position_title || row.profiles?.position_title || undefined,
    branchId: row.branch_id,
    workDate: row.work_date,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    shiftId: row.shift_id || undefined,
    status: row.status,
    note: row.note || '',
    reviewedBy: row.reviewed_by || undefined,
    reviewedAt: row.reviewed_at || undefined,
    rejectionReason: row.rejection_reason || undefined,
    createdAt: row.created_at,
  }
}

function mapWorkShift(row: any): WorkShift | undefined {
  if (!row) return undefined
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    graceMinutes: row.grace_minutes,
    recommendedStaff: row.recommended_staff || 3,
    employmentTypes: row.employment_types || undefined,
    active: row.active,
  }
}

function isMissingRpcError(error: any) {
  const message = String(error?.message || error?.details || '')
  return error?.code === 'PGRST202'
    || /function .* does not exist|could not find.*function|schema cache/i.test(message)
}

function friendlyRegistrationError(error: any) {
  const message = String(error?.message || '')
  if (/duplicate key|unique constraint|shift_registrations_user_id_work_date_start_time_end_time/i.test(message)) {
    return new Error('Ca nay da co trong lich cua ban.')
  }
  if (/row-level security|violates row-level security|permission denied/i.test(message)) {
    return new Error('Chưa lưu được ca do quyền dữ liệu trên Supabase. Hãy chạy migration lịch làm mới rồi thử lại.')
  }
  return error instanceof Error ? error : new Error(message || 'Không thể đăng ký ca.')
}

function friendlyShiftSetupError(error: any) {
  const message = String(error?.message || error?.details || '')
  if (/duplicate key|unique constraint|shifts_branch_id_name_key/i.test(message)) {
    return new Error('Khung ca này đã tồn tại. Hãy đổi tên ca hoặc cập nhật lại khung ca cũ.')
  }
  if (/foreign key|violates foreign key|branches/i.test(message)) {
    return new Error('Chi nhánh này chưa được đồng bộ lên Supabase. Hãy lưu chi nhánh trong Trung tâm quản trị rồi thử lại.')
  }
  if (/row-level security|violates row-level security|permission denied/i.test(message)) {
    return new Error('Chưa xử lý được khung ca do quyền dữ liệu trên Supabase. Hãy chạy migration ca làm an toàn rồi thử lại.')
  }
  if (/not found|khong tim thay|không tìm thấy/i.test(message)) {
    return new Error('Không tìm thấy khung ca này hoặc ca đã bị xóa.')
  }
  return error instanceof Error ? error : new Error(message || 'Không thể xử lý khung ca.')
}

function mapAttendance(row: any): AttendanceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.profiles?.full_name || 'Nhân viên',
    branchId: row.branch_id,
    shiftRegistrationId: row.shift_registration_id,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time || undefined,
    selfieUrl: row.selfie_url,
    checkOutSelfieUrl: row.check_out_selfie_url || row.checkout_selfie_url || undefined,
    checkInLatitude: row.check_in_latitude === null || row.check_in_latitude === undefined ? undefined : Number(row.check_in_latitude),
    checkInLongitude: row.check_in_longitude === null || row.check_in_longitude === undefined ? undefined : Number(row.check_in_longitude),
    checkInAccuracy: row.check_in_accuracy === null || row.check_in_accuracy === undefined ? undefined : Number(row.check_in_accuracy),
    checkInAddress: row.check_in_address || undefined,
    checkOutLatitude: row.check_out_latitude === null || row.check_out_latitude === undefined ? undefined : Number(row.check_out_latitude),
    checkOutLongitude: row.check_out_longitude === null || row.check_out_longitude === undefined ? undefined : Number(row.check_out_longitude),
    checkOutAccuracy: row.check_out_accuracy === null || row.check_out_accuracy === undefined ? undefined : Number(row.check_out_accuracy),
    checkOutAddress: row.check_out_address || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function localDateTime(date: string, time: string, nextDay = false) {
  const value = new Date(`${date}T${time}:00`)
  if (nextDay) value.setDate(value.getDate() + 1)
  return value
}

export function findAttendanceRecordForRegistration(records: AttendanceRecord[], registration: ShiftRegistration) {
  const exact = records.find((item) => item.shiftRegistrationId === registration.id)
  if (exact) return exact
  const startsAt = localDateTime(registration.workDate, registration.startTime)
  const endsAt = localDateTime(registration.workDate, registration.endTime, registration.endTime <= registration.startTime)
  const opensAt = new Date(startsAt.getTime() - 45 * 60000)
  const closesAt = new Date(endsAt.getTime() + 60 * 60000)
  return records.find((item) => {
    if (item.userId !== registration.userId || item.branchId !== registration.branchId) return false
    // Chỉ ghép theo khung giờ cho dữ liệu cũ chưa có mã đăng ký ca. Bản ghi
    // đã gắn với ca khác không được dùng lại cho ca tăng ca cùng ngày.
    if (item.shiftRegistrationId) return false
    const checkedAt = new Date(item.checkInTime)
    return checkedAt >= opensAt && checkedAt <= closesAt
  })
}

export function isOvertimeRegistration(registration: Pick<ShiftRegistration, 'note'>) {
  const normalizedNote = (registration.note || '')
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return normalizedNote.includes('tang ca')
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export interface AttendanceDetailRow {
  registrationId: string
  attendanceRecordId?: string
  userId: string
  employeeName: string
  branchId: string
  workDate: string
  scheduledStart: string
  scheduledEnd: string
  checkInTime?: string
  checkOutTime?: string
  checkOutSelfieUrl?: string
  totalHours: number
  isOvertime: boolean
  workDayCredit: number
  lateMinutes: number
  status: 'completed' | 'working' | 'absent' | 'scheduled'
  checkInAddress?: string
  checkInLatitude?: number
  checkInLongitude?: number
  checkOutAddress?: string
  checkOutLatitude?: number
  checkOutLongitude?: number
  selfieUrl?: string
  note: string
}

export function buildAttendanceDetailRows(
  registrations: ShiftRegistration[],
  records: AttendanceRecord[],
  graceMinutesByShift: Map<string, number>,
  now = new Date(),
): AttendanceDetailRow[] {
  const matchedRecordIds = new Set<string>()
  const rows = registrations.filter((item) => item.status !== 'rejected').map((registration) => {
    const record = findAttendanceRecordForRegistration(records, registration)
    if (record) matchedRecordIds.add(record.id)
    const scheduledStart = localDateTime(registration.workDate, registration.startTime)
    const scheduledEnd = localDateTime(registration.workDate, registration.endTime, registration.endTime <= registration.startTime)
    const checkIn = record ? new Date(record.checkInTime) : undefined
    const checkOut = record?.checkOutTime ? new Date(record.checkOutTime) : undefined
    const grace = graceMinutesByShift.get(registration.shiftId || '') ?? 5
    const lateMinutes = checkIn
      ? Math.max(0, Math.round((checkIn.getTime() - scheduledStart.getTime()) / 60000) - grace)
      : 0
    const status: AttendanceDetailRow['status'] = record
      ? checkOut ? 'completed' : 'working'
      : now > scheduledEnd ? 'absent' : 'scheduled'
    return {
      registrationId: registration.id,
      attendanceRecordId: record?.id,
      userId: registration.userId,
      employeeName: registration.userName,
      branchId: registration.branchId,
      workDate: registration.workDate,
      scheduledStart: registration.startTime,
      scheduledEnd: registration.endTime,
      checkInTime: record?.checkInTime,
      checkOutTime: record?.checkOutTime,
      checkOutSelfieUrl: record?.checkOutSelfieUrl,
      totalHours: checkIn && checkOut ? Number(Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000).toFixed(2)) : 0,
      isOvertime: isOvertimeRegistration(registration),
      workDayCredit: checkIn && checkOut
        ? workDayCredit(Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000), scheduledStart, scheduledEnd)
        : 0,
      lateMinutes,
      status,
      checkInAddress: record?.checkInAddress,
      checkInLatitude: record?.checkInLatitude,
      checkInLongitude: record?.checkInLongitude,
      checkOutAddress: record?.checkOutAddress,
      checkOutLatitude: record?.checkOutLatitude,
      checkOutLongitude: record?.checkOutLongitude,
      selfieUrl: record?.selfieUrl,
      note: registration.note,
    }
  })
  for (const record of records) {
    if (matchedRecordIds.has(record.id)) continue
    const checkIn = new Date(record.checkInTime)
    const checkOut = record.checkOutTime ? new Date(record.checkOutTime) : undefined
    const totalHours = checkOut ? Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000) : 0
    rows.push({
      registrationId: record.shiftRegistrationId || `record:${record.id}`,
      attendanceRecordId: record.id,
      userId: record.userId,
      employeeName: record.userName,
      branchId: record.branchId,
      workDate: localDateKey(checkIn),
      scheduledStart: localTimeKey(checkIn),
      scheduledEnd: checkOut ? localTimeKey(checkOut) : '',
      checkInTime: record.checkInTime,
      checkOutTime: record.checkOutTime,
      checkOutSelfieUrl: record.checkOutSelfieUrl,
      totalHours: Number(totalHours.toFixed(2)),
      isOvertime: false,
      workDayCredit: checkOut ? orphanWorkDayCredit(totalHours) : 0,
      lateMinutes: 0,
      status: checkOut ? 'completed' : 'working',
      checkInAddress: record.checkInAddress,
      checkInLatitude: record.checkInLatitude,
      checkInLongitude: record.checkInLongitude,
      checkOutAddress: record.checkOutAddress,
      checkOutLatitude: record.checkOutLatitude,
      checkOutLongitude: record.checkOutLongitude,
      selfieUrl: record.selfieUrl,
      note: 'Ca chấm công đã ghi nhận, chưa khớp lịch',
    })
  }
  return rows.sort((a, b) => b.workDate.localeCompare(a.workDate) || a.scheduledStart.localeCompare(b.scheduledStart))
}

function scheduledHours(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / 3600000)
}

function localTimeKey(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function workDayCredit(workedHours: number, scheduledStart: Date, scheduledEnd: Date) {
  const plannedHours = scheduledHours(scheduledStart, scheduledEnd)
  if (!plannedHours || !workedHours) return 0
  return Number(Math.min(1, workedHours / plannedHours).toFixed(2))
}

function orphanWorkDayCredit(workedHours: number) {
  return Number(Math.min(1, workedHours / 8).toFixed(2))
}

/** Lỗi định vị có thông điệp thân thiện để UI hiển thị trực tiếp. */
export class AttendanceLocationError extends Error {}

async function getAttendanceLocation() {
  if (!navigator.geolocation) {
    throw new AttendanceLocationError('Thiết bị/trình duyệt không hỗ trợ định vị. Hãy mở bằng trình duyệt có GPS để chấm công.')
  }
  const position = await getBestGeolocationPosition().catch((error: GeolocationPositionError | Error | null) => error)
  if (!position || !('coords' in position)) {
    const denied = position && 'code' in position && position.code === position.PERMISSION_DENIED
    throw new AttendanceLocationError(
      denied
        ? 'Safari đang chặn quyền định vị cho website này. Vào Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Safari Websites → Khi dùng ứng dụng, đồng thời bật Vị trí chính xác.'
        : position instanceof Error && position.message
          ? position.message
          : 'Không lấy được GPS. Hãy kiểm tra quyền định vị và sóng GPS rồi thử lại.',
    )
  }
  const latitude = position.coords.latitude
  const longitude = position.coords.longitude
  const accuracy = position.coords.accuracy
  let address = ''
  try {
    // Có timeout để tránh treo nút chấm công khi dịch vụ địa chỉ chậm/không phản hồi.
    const response = await fetchWithTimeout(`/api/reverse-geocode?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`, 5000)
    if (response.ok) {
      const payload = await response.json()
      if (payload?.address) address = payload.address
    }
  } catch {}
  if (!isConcreteAttendanceAddress(address)) address = await reverseGeocodeFromBrowser(latitude, longitude).catch(() => '')
  address = requireConcreteAttendanceAddress(address)
  return { latitude, longitude, accuracy, address }
}

async function getTrustedTimestamp() {
  try {
    const response = await fetchWithTimeout('/api/server-time', 3500, { cache: 'no-store' })
    if (response.ok) {
      const payload = await response.json()
      const value = new Date(payload?.now)
      if (Number.isFinite(value.getTime())) return value.toISOString()
    }
  } catch {
    // Offline/LAN cũ vẫn cho chấm công bằng đồng hồ thiết bị thay vì khóa người dùng.
  }
  return new Date().toISOString()
}

// fetch có timeout cứng: chấm công không được treo vì một request địa chỉ chậm.
async function fetchWithTimeout(input: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

async function reverseGeocodeFromBrowser(latitude: number, longitude: number) {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('localityLanguage', 'vi')
  const response = await fetchWithTimeout(url.toString(), 5000)
  if (!response.ok) throw new Error('Không lấy được địa chỉ.')
  const payload = await response.json()
  const parts = [
    payload.locality,
    payload.city,
    payload.principalSubdivision,
    payload.countryName,
  ].filter(Boolean)
  const uniqueParts = parts.filter((value, index) => parts.indexOf(value) === index)
  if (!uniqueParts.length) throw new Error('Không có địa chỉ.')
  return uniqueParts.join(', ')
}

function isCoordinateOnlyAddress(value: string) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value.trim())
}

function isConcreteAttendanceAddress(value: string) {
  const cleaned = value
    .replace(/\s*[·|-]\s*GPS\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\s*$/i, '')
    .trim()
  return Boolean(cleaned)
    && !isCoordinateOnlyAddress(cleaned)
    && !/^(?:Vị trí GPS|GPS|Chưa lấy được địa chỉ)/i.test(cleaned)
}

function requireConcreteAttendanceAddress(value: string) {
  const cleaned = value
    .replace(/\s*[·|-]\s*GPS\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\s*$/i, '')
    .trim()
  if (!isConcreteAttendanceAddress(cleaned)) {
    throw new AttendanceLocationError('Chưa lấy được địa chỉ cụ thể. Hãy kiểm tra kết nối mạng rồi chấm công lại.')
  }
  return cleaned
}

function getBestGeolocationPosition() {
  const maximumAccuracyMetres = 150
  const targetAccuracyMetres = 35
  const attemptTimeouts = [10000, 7000]
  return (async () => {
    let best: GeolocationPosition | undefined
    let lastError: unknown
    for (const timeoutMs of attemptTimeouts) {
      try {
        const position = await requestFreshGeolocationPosition(timeoutMs)
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position
        if (best.coords.accuracy <= targetAccuracyMetres) break
      } catch (error) {
        lastError = error
        if (Number((error as GeolocationPositionError | undefined)?.code) === 1) break
      }
    }
    if (best && best.coords.accuracy <= maximumAccuracyMetres) return best
    if (best) {
      throw new AttendanceLocationError(`GPS hiện sai số ±${Math.round(best.coords.accuracy)}m, chưa đủ chính xác để chấm công. Hãy ra gần cửa sổ/ngoài trời, bật Vị trí chính xác rồi thử lại.`)
    }
    throw lastError || new AttendanceLocationError('Không lấy được GPS mới. Hãy kiểm tra quyền định vị và thử lại.')
  })()
}

function requestFreshGeolocationPosition(timeoutMs: number) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (error) => {
      if (error.code === error.PERMISSION_DENIED && typeof window !== 'undefined' && !window.isSecureContext) {
        reject(new AttendanceLocationError('Safari không cho link HTTP dùng định vị. Hãy mở đúng bản HTTPS để chấm công; bật định vị trong máy không thể bỏ qua giới hạn này.'))
        return
      }
      reject(error)
    }, {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 0,
    })
  })
}

async function stampAttendancePhoto(
  selfie: Blob,
  details: {
    actionLabel: string
    employeeName: string
    branchName: string
    timestamp: string
    address: string
    latitude: number
    longitude: number
    accuracy: number
    totalHoursLabel?: string
  },
) {
  const decoded = await decodeImageForCanvas(selfie)
  const maxWidth = 1280
  const scale = Math.min(1, maxWidth / decoded.width)
  const width = Math.round(decoded.width * scale)
  const height = Math.round(decoded.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không thể xử lý ảnh selfie.')
  context.drawImage(decoded.source, 0, 0, width, height)
  decoded.close()
  const panelHeight = Math.max(190, Math.round(height * .3))
  const gradient = context.createLinearGradient(0, height - panelHeight, 0, height)
  gradient.addColorStop(0, 'rgba(6,18,31,0)')
  gradient.addColorStop(.28, 'rgba(6,18,31,.72)')
  gradient.addColorStop(1, 'rgba(6,18,31,.94)')
  context.fillStyle = gradient
  context.fillRect(0, height - panelHeight, width, panelHeight)
  const padding = Math.max(18, Math.round(width * .025))
  const lines = [
    `${details.actionLabel} · ${details.employeeName}`,
    details.branchName,
    new Date(details.timestamp).toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Bangkok' }),
    details.address,
    `GPS ${details.latitude.toFixed(6)}, ${details.longitude.toFixed(6)} · sai số ±${Math.round(details.accuracy)}m`,
    ...(details.totalHoursLabel ? [details.totalHoursLabel] : []),
  ]
  context.textBaseline = 'bottom'
  lines.forEach((line, index) => {
    context.font = `${index === 0 ? '700' : '500'} ${Math.max(16, Math.round(width * (index === 0 ? .025 : .018)))}px Arial`
    context.fillStyle = index === 0 ? '#d9f47d' : '#ffffff'
    context.fillText(fitCanvasText(context, line, width - padding * 2), padding, height - padding - (lines.length - 1 - index) * Math.max(24, Math.round(width * .027)))
  })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Không thể lưu ảnh đã đóng dấu.')), 'image/jpeg', .9)
  })
}

function fitCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 12 && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1)
  return `${value}…`
}
