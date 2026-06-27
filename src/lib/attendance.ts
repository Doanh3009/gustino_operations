import { createId } from './browser'
import { BRANCHES } from './constants'
import { supabase } from './supabase'
import { usernameToEmail, validateUsername } from './authIdentity'
import type {
  AppUser,
  AttendanceRecord,
  AttendanceReportRow,
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

function queryString(filters: AttendanceFilters) {
  const params = new URLSearchParams()
  if (filters.branchId) params.set('branchId', filters.branchId)
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  return params.toString()
}

export function permittedBranchIds(user: AppUser) {
  return Array.from(new Set([user.branchId, ...(user.branchIds || [])]))
}

export async function fetchWorkShifts(user: AppUser): Promise<WorkShift[]> {
  if (!supabase) return attendanceApi(user, '/shifts')
  const { data, error } = await supabase.from('shifts').select('*').eq('active', true).order('start_time')
  if (error) throw error
  return (data || []).map((row) => ({
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

export async function fetchEmployees(user: AppUser): Promise<EmployeeProfile[]> {
  if (!supabase) return attendanceApi(user, '/employees')
  const branches = permittedBranchIds(user)
  let query = supabase.from('profiles').select('id, full_name, email, role, branch_id, active, employment_type, position_title').order('full_name')
  query = query.in('branch_id', branches)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    name: row.full_name,
    email: row.email || undefined,
    role: row.role,
    branchId: row.branch_id || undefined,
    active: row.active !== false,
    employmentType: row.employment_type || undefined,
    positionTitle: row.position_title || undefined,
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
  return (data || []).map((row: any, index: number) => ({
    id: row.id,
    profileId: row.profile_id || (row.role ? row.id : undefined),
    name: row.full_name,
    branchId: row.branch_id,
    active: row.active !== false,
    employmentType: row.employment_type || undefined,
    positionTitle: row.position_title || undefined,
    sortOrder: Number(row.sort_order ?? index),
  }))
}

export async function fetchScheduleEntries(
  user: AppUser,
  filters: { branchId: string; from: string; to: string },
): Promise<ScheduleEntry[]> {
  if (!supabase) return []
  const { data, error } = await supabase
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
  if (user.role !== 'manager') throw new Error('Chỉ Quản lý được thêm nhân sự vào bảng lịch.')
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
  if (user.role !== 'manager') throw new Error('Chỉ Quản lý được xóa dòng nhân sự.')
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
  if (user.role !== 'manager') throw new Error('Chỉ Quản lý được tạo khung ca.')
  if (!supabase) throw new Error('Cần kết nối Supabase để tạo khung ca.')
  const { error } = await supabase.from('shifts').insert({
    branch_id: input.branchId,
    name: input.name.trim(),
    start_time: input.startTime,
    end_time: input.endTime,
    grace_minutes: 5,
    recommended_staff: 3,
    employment_types: input.employmentTypes || [],
    active: true,
    created_by: user.id,
  })
  if (error) throw error
}

export async function archiveWorkShift(user: AppUser, shiftId: string) {
  if (user.role !== 'manager') throw new Error('Chỉ Quản lý được xóa khung ca.')
  if (!supabase) throw new Error('Cần kết nối Supabase để xóa khung ca.')
  const { error } = await supabase.from('shifts').update({ active: false }).eq('id', shiftId)
  if (error) throw error
}

export interface CreateEmployeeAccountInput {
  name: string
  username: string
  branchId: string
  role: Exclude<Role, 'admin'>
  employmentType: EmploymentType
  positionTitle: string
  password: string
}

export async function createEmployeeAccount(user: AppUser, input: CreateEmployeeAccountInput): Promise<EmployeeProfile> {
  if (user.role !== 'manager') throw new Error('Chỉ quản lý được tạo tài khoản nhân viên.')
  const username = validateUsername(input.username)
  if (input.password.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.')
  const payload = {
    ...input,
    username,
    email: usernameToEmail(username),
    temporaryPassword: input.password,
  }
  if (!supabase) {
    return attendanceApi<EmployeeProfile>(user, '/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }
  const data = await invokeManageEmployee({ action: 'create', ...payload })
  return data.employee as EmployeeProfile
}

export async function resetEmployeePassword(user: AppUser, employeeId: string, temporaryPassword: string): Promise<void> {
  if (user.role !== 'manager') throw new Error('Chỉ quản lý được đặt lại mật khẩu.')
  if (!supabase) {
    await attendanceApi(user, `/employees/${employeeId}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ temporaryPassword }),
    })
    return
  }
  await invokeManageEmployee({ action: 'reset_password', employeeId, password: temporaryPassword })
}

export async function deleteEmployeeAccount(user: AppUser, employeeId: string): Promise<void> {
  if (user.role !== 'manager') throw new Error('Chỉ quản lý được xóa tài khoản.')
  if (employeeId === user.id) throw new Error('Bạn không thể xóa tài khoản đang đăng nhập.')
  if (!supabase) {
    await attendanceApi(user, `/employees/${employeeId}`, { method: 'DELETE' })
    return
  }
  await invokeManageEmployee({ action: 'delete', employeeId })
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
      throw new Error('Supabase chưa xác nhận được phiên Quản lý. Hãy bấm lại thao tác, không cần đăng nhập lại.')
    }
    throw new Error(payload?.error || result.error.message || 'Không thể quản lý tài khoản.')
  }
  if (result.data?.error) throw new Error(result.data.error)
  return result.data
}

export async function updateEmployeeRole(user: AppUser, employeeId: string, role: Role): Promise<void> {
  if (user.role !== 'manager') throw new Error('Chỉ quản lý được thay đổi phân quyền.')
  if (role === 'admin') throw new Error('Vai trò Admin đã được gộp vào Quản lý.')
  if (employeeId === user.id && role !== 'manager') throw new Error('Bạn không thể tự hạ quyền Quản lý của chính mình.')
  if (!supabase) {
    await attendanceApi(user, `/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
    return
  }
  const { error } = await supabase.rpc('manager_update_profile_role', {
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
  },
): Promise<EmployeeProfile> {
  if (user.role !== 'manager') throw new Error('Chỉ quản lý được chỉnh sửa hồ sơ nhân viên.')
  if (employeeId === user.id && patch.role && patch.role !== 'manager') {
    throw new Error('Bạn không thể tự hạ quyền Quản lý của chính mình.')
  }
  if (!supabase) {
    return attendanceApi<EmployeeProfile>(user, `/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }
  const data = await invokeManageEmployee({ action: 'update', employeeId, ...patch })
  return data.employee as EmployeeProfile
}

export async function fetchShiftRegistrations(user: AppUser, filters: AttendanceFilters = {}): Promise<ShiftRegistration[]> {
  if (!supabase) return attendanceApi(user, `/registrations?${queryString(filters)}`)
  let query = supabase
    .from('shift_registrations')
    .select('*, profiles!shift_registrations_user_id_fkey(full_name)')
    .order('work_date', { ascending: false })
    .order('start_time')
  if (filters.branchId) query = query.eq('branch_id', filters.branchId)
  if (filters.userId) query = query.eq('user_id', filters.userId)
  if (filters.from) query = query.gte('work_date', filters.from)
  if (filters.to) query = query.lte('work_date', filters.to)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(mapRegistration)
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
  if (!supabase) {
    await attendanceApi(user, '/registrations', { method: 'POST', body: JSON.stringify(registration) })
    return registration
  }
  const { error } = await supabase.from('shift_registrations').insert({
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
  if (error) throw error
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
  const canEdit = input.userId === actor.id || actor.role === 'manager'
  if (!canEdit) throw new Error('Bạn chỉ được thêm ca cho chính mình.')
  if (actor.role !== 'manager' && input.workDate < new Date().toISOString().slice(0, 10)) {
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
  if (!supabase) {
    if (input.userId !== actor.id) throw new Error('Máy chủ local chỉ hỗ trợ nhân viên tự thêm ca của mình.')
    await attendanceApi(actor, '/registrations', { method: 'POST', body: JSON.stringify(registration) })
    return registration
  }
  const result = await supabase.rpc('add_manual_shift_registration', {
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
  const { error } = await supabase.from('shift_registrations').insert({
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

export async function setScheduleRegistration(
  user: AppUser,
  input: {
    userId: string
    userName: string
    branchId: string
    workDate: string
    shift?: WorkShift
    employmentType?: EmploymentType
    positionTitle?: string
  },
) {
  const canEdit = input.userId === user.id || user.role === 'manager'
  if (!canEdit) throw new Error('Bạn chỉ được chỉnh lịch của chính mình.')
  if (!supabase) {
    return attendanceApi<ShiftRegistration | null>(user, '/registrations/cell', {
      method: 'PUT',
      body: JSON.stringify({
        ...input,
        shiftId: input.shift?.id,
        startTime: input.shift?.startTime,
        endTime: input.shift?.endTime,
      }),
    })
  }
  const { data, error } = await supabase.rpc('set_schedule_registration', {
    p_user_id: input.userId,
    p_branch_id: input.branchId,
    p_work_date: input.workDate,
    p_shift_id: input.shift?.id || null,
  })
  if (error) throw error
  return data
}

export async function fetchAttendanceRecords(user: AppUser, filters: AttendanceFilters = {}): Promise<AttendanceRecord[]> {
  if (!supabase) return attendanceApi(user, `/records?${queryString(filters)}`)
  let query = supabase
    .from('attendance_records')
    .select('*, profiles!attendance_records_user_id_fkey(full_name)')
    .order('check_in_time', { ascending: false })
  if (user.role === 'staff') query = query.eq('user_id', user.id)
  if (filters.branchId) query = query.eq('branch_id', filters.branchId)
  if (filters.userId) query = query.eq('user_id', filters.userId)
  if (filters.from) query = query.gte('check_in_time', `${filters.from}T00:00:00`)
  if (filters.to) query = query.lte('check_in_time', `${filters.to}T23:59:59`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(mapAttendance)
}

export async function checkIn(user: AppUser, registration: ShiftRegistration, selfie: Blob) {
  if (registration.userId !== user.id || registration.status === 'rejected') {
    throw new Error('Ca làm không hợp lệ hoặc không thuộc tài khoản này.')
  }
  const now = new Date().toISOString()
  const location = await getAttendanceLocation()
  const stampedSelfie = await stampAttendancePhoto(selfie, {
    actionLabel: 'CHECK-IN',
    employeeName: user.name,
    branchName: BRANCHES.find((branch) => branch.id === registration.branchId)?.name || registration.branchId,
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
  if (!supabase) {
    await attendanceApi(user, '/records', { method: 'POST', body: JSON.stringify(record) })
    return record
  }
  const { error } = await supabase.from('attendance_records').insert({
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
  if (error) throw error
  return record
}

export async function checkOut(user: AppUser, record: AttendanceRecord) {
  if (record.userId !== user.id || record.checkOutTime) throw new Error('Bản ghi này không thể check-out.')
  const checkOutTime = new Date().toISOString()
  if (!supabase) {
    await attendanceApi(user, `/records/${record.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ checkOutTime, updatedAt: checkOutTime }),
    })
    return
  }
  const { error } = await supabase.from('attendance_records').update({
    check_out_time: checkOutTime,
    updated_at: checkOutTime,
  }).eq('id', record.id).eq('user_id', user.id).is('check_out_time', null)
  if (error) throw error
}

async function uploadSelfie(user: AppUser, registration: ShiftRegistration, selfie: Blob) {
  if (!selfie.size) throw new Error('Ảnh selfie là bắt buộc.')
  if (!supabase) {
    const dataUrl = await blobToDataUrl(selfie)
    const result = await attendanceApi<{ url: string }>(user, '/selfies', {
      method: 'POST',
      body: JSON.stringify({ registrationId: registration.id, branchId: registration.branchId, dataUrl }),
    })
    return result.url
  }
  const path = `${user.id}/${registration.branchId}/${registration.id}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('attendance-selfies').upload(path, selfie, {
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
  for (const registration of registrations.filter((item) => item.status !== 'rejected')) {
    const key = `${registration.userId}|${registration.branchId}`
    const row = groups.get(key) || {
      userId: registration.userId,
      employeeName: registration.userName,
      branchId: registration.branchId,
      totalShifts: 0,
      totalHours: 0,
      workDays: 0,
      lateCount: 0,
      absentCount: 0,
      missingCheckoutCount: 0,
    }
    const record = records.find((item) => item.shiftRegistrationId === registration.id)
    const scheduledStart = localDateTime(registration.workDate, registration.startTime)
    const scheduledEnd = localDateTime(registration.workDate, registration.endTime, registration.endTime <= registration.startTime)
    if (!record && now > scheduledEnd) row.absentCount += 1
    if (record) {
      row.totalShifts += 1
      const checkIn = new Date(record.checkInTime)
      const grace = graceMinutesByShift.get(registration.shiftId || '') ?? 5
      if (checkIn.getTime() > scheduledStart.getTime() + grace * 60000) row.lateCount += 1
      if (record.checkOutTime) {
        const workedHours = Math.max(0, (new Date(record.checkOutTime).getTime() - checkIn.getTime()) / 3600000)
        row.totalHours += workedHours
        row.workDays += workDayCredit(workedHours, scheduledStart, scheduledEnd)
      } else if (now > scheduledEnd) {
        row.missingCheckoutCount += 1
      }
    }
    groups.set(key, row)
  }
  return Array.from(groups.values()).map((row) => ({
    ...row,
    totalHours: Number(row.totalHours.toFixed(2)),
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
    checkInLatitude: row.check_in_latitude === null || row.check_in_latitude === undefined ? undefined : Number(row.check_in_latitude),
    checkInLongitude: row.check_in_longitude === null || row.check_in_longitude === undefined ? undefined : Number(row.check_in_longitude),
    checkInAccuracy: row.check_in_accuracy === null || row.check_in_accuracy === undefined ? undefined : Number(row.check_in_accuracy),
    checkInAddress: row.check_in_address || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function localDateTime(date: string, time: string, nextDay = false) {
  const value = new Date(`${date}T${time}:00`)
  if (nextDay) value.setDate(value.getDate() + 1)
  return value
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
  userId: string
  employeeName: string
  branchId: string
  workDate: string
  scheduledStart: string
  scheduledEnd: string
  checkInTime?: string
  checkOutTime?: string
  totalHours: number
  workDayCredit: number
  lateMinutes: number
  status: 'completed' | 'working' | 'absent' | 'scheduled'
  checkInAddress?: string
  checkInLatitude?: number
  checkInLongitude?: number
  selfieUrl?: string
  note: string
}

export function buildAttendanceDetailRows(
  registrations: ShiftRegistration[],
  records: AttendanceRecord[],
  graceMinutesByShift: Map<string, number>,
  now = new Date(),
): AttendanceDetailRow[] {
  return registrations.filter((item) => item.status !== 'rejected').map((registration) => {
    const record = records.find((item) => item.shiftRegistrationId === registration.id)
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
      userId: registration.userId,
      employeeName: registration.userName,
      branchId: registration.branchId,
      workDate: registration.workDate,
      scheduledStart: registration.startTime,
      scheduledEnd: registration.endTime,
      checkInTime: record?.checkInTime,
      checkOutTime: record?.checkOutTime,
      totalHours: checkIn && checkOut ? Number(Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000).toFixed(2)) : 0,
      workDayCredit: checkIn && checkOut
        ? workDayCredit(Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3600000), scheduledStart, scheduledEnd)
        : 0,
      lateMinutes,
      status,
      checkInAddress: record?.checkInAddress,
      checkInLatitude: record?.checkInLatitude,
      checkInLongitude: record?.checkInLongitude,
      selfieUrl: record?.selfieUrl,
      note: registration.note,
    }
  }).sort((a, b) => b.workDate.localeCompare(a.workDate) || a.scheduledStart.localeCompare(b.scheduledStart))
}

function scheduledHours(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / 3600000)
}

function workDayCredit(workedHours: number, scheduledStart: Date, scheduledEnd: Date) {
  const plannedHours = scheduledHours(scheduledStart, scheduledEnd)
  if (!plannedHours || !workedHours) return 0
  return Number(Math.min(1, workedHours / plannedHours).toFixed(2))
}

/** Lỗi định vị có thông điệp thân thiện để UI hiển thị trực tiếp. */
export class AttendanceLocationError extends Error {}

async function getAttendanceLocation() {
  if (!navigator.geolocation) {
    throw new AttendanceLocationError('Thiết bị/trình duyệt không hỗ trợ định vị. Hãy mở bằng trình duyệt có GPS để chấm công.')
  }
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    })
  }).catch((error: GeolocationPositionError | null) => {
    return error
  })
  if (!position || 'code' in position) {
    const denied = position && 'code' in position && position.code === position.PERMISSION_DENIED
    throw new AttendanceLocationError(
      denied
        ? 'Bạn cần cho phép quyền định vị (GPS) thì mới chấm công được. Hãy bật định vị rồi thử lại.'
        : 'Không lấy được GPS. Hãy kiểm tra quyền định vị và sóng GPS rồi thử lại.',
    )
  }
  const latitude = position.coords.latitude
  const longitude = position.coords.longitude
  const accuracy = position.coords.accuracy
  let address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
  try {
    const response = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`)
    if (response.ok) {
      const payload = await response.json()
      if (payload?.address) address = payload.address
    }
  } catch {
    // Tọa độ vẫn được đóng dấu nếu dịch vụ địa chỉ tạm thời không phản hồi.
  }
  return { latitude, longitude, accuracy, address }
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
  },
) {
  const bitmap = await createImageBitmap(selfie)
  const maxWidth = 1280
  const scale = Math.min(1, maxWidth / bitmap.width)
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không thể xử lý ảnh selfie.')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
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
    new Date(details.timestamp).toLocaleString('vi-VN', { hour12: false }),
    details.address,
    `GPS ${details.latitude.toFixed(6)}, ${details.longitude.toFixed(6)} · sai số ±${Math.round(details.accuracy)}m`,
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
