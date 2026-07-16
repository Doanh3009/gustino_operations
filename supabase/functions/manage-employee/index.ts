import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authorization = request.headers.get('Authorization') || ''
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    })
    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { data: { user }, error: userError } = await callerClient.auth.getUser()
    if (userError || !user) return response(401, { error: 'Chưa đăng nhập.' })

    const { data: adminProfile } = await adminClient
      .from('profiles')
      .select('id, role, branch_id, active')
      .eq('id', user.id)
      .single()
    if (!adminProfile || adminProfile.role !== 'admin' || adminProfile.active === false) {
      return response(403, { error: 'Chỉ Admin hệ thống được quản lý tài khoản nhân viên.' })
    }

    const payload = await request.json()
    if (payload.action === 'create') {
      const name = String(payload.name || '').trim()
      const username = normalizeUsername(String(payload.username || ''))
      const email = String(payload.email || '').trim().toLowerCase()
      const password = String(payload.password || payload.temporaryPassword || '')
      const role = String(payload.role || 'staff')
      const branchlessRole = role === 'manager' || role === 'kitchen'
      const branchId = branchlessRole ? null : String(payload.branchId || '')
      const branchName = String(payload.branchName || branchId || '').trim()
      const employmentType = String(payload.employmentType || (role === 'shift_leader' ? 'leader' : 'part_time'))
      const positionTitle = String(payload.positionTitle || '').trim()
      if (!name || username.length < 3 || !email.includes('@')) return response(400, { error: 'Tên và tên đăng nhập không hợp lệ.' })
      if (password.length < 6) return response(400, { error: 'Mật khẩu cần ít nhất 6 ký tự.' })
      if (!['manager', 'shift_leader', 'staff', 'kitchen'].includes(role)) return response(400, { error: 'Vai trò không hợp lệ.' })
      if (!['leader', 'full_time', 'part_time'].includes(employmentType)) return response(400, { error: 'Nhóm ca không hợp lệ.' })
      if (!branchlessRole && !(await canManageBranch(adminClient, user.id, adminProfile.role, adminProfile.branch_id, branchId))) {
        return response(403, { error: 'Không có quyền tạo tài khoản tại chi nhánh này.' })
      }

      if (!branchlessRole && !branchId) return response(400, { error: 'Vui lÃ²ng chá»n chi nhÃ¡nh cho nhÃ¢n viÃªn.' })
      if (!branchlessRole) {
        const branchError = await ensureBranch(adminClient, branchId, branchName || branchId)
        if (branchError) return response(400, { error: branchError })
        await seedDefaultShifts(adminClient, branchId)
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name, role, branch_id: branchId, employment_type: employmentType, position_title: positionTitle },
      })
      if (createError || !created.user) {
        const message = createError?.message?.toLowerCase().includes('already')
          ? 'Tên đăng nhập này đã được sử dụng.'
          : createError?.message || 'Không thể tạo tài khoản.'
        return response(400, { error: message })
      }
      const { error: profileError } = await adminClient.from('profiles').upsert({
        id: created.user.id,
        full_name: name,
        email,
        role,
        branch_id: branchId,
        active: true,
        employment_type: employmentType,
        position_title: positionTitle,
        avatar_url: null,
      })
      if (profileError) {
        await adminClient.auth.admin.deleteUser(created.user.id)
        return response(400, { error: profileError.message })
      }
      return response(200, {
        employee: { id: created.user.id, name, email, username, role, branchId: branchId || undefined, active: true, employmentType, positionTitle },
      })
    }

    if (payload.action === 'delete_branch') {
      const branchId = String(payload.branchId || '').trim()
      if (!branchId) return response(400, { error: 'Chi nhanh khong hop le.' })
      const { data: branch } = await adminClient
        .from('branches')
        .select('id, name')
        .eq('id', branchId)
        .maybeSingle()
      if (!branch) return response(404, { error: 'Khong tim thay chi nhanh.' })
      if (!(await canManageBranch(adminClient, user.id, adminProfile.role, adminProfile.branch_id, branchId))) {
        return response(403, { error: 'Khong co quyen xoa chi nhanh nay.' })
      }
      const { data: branchProfiles } = await adminClient
        .from('profiles')
        .select('id')
        .eq('branch_id', branchId)
      const profileIds = (branchProfiles || []).map((item: { id: string }) => item.id).filter((id: string) => id !== user.id)
      await hardDeleteBranch(adminClient, branchId, profileIds, adminProfile.id)
      return response(200, { ok: true, deletedProfiles: profileIds.length })
    }

    const employeeId = String(payload.employeeId || '')
    if (!employeeId) return response(400, { error: 'Tài khoản không hợp lệ.' })
    const { data: employee } = await adminClient
      .from('profiles')
      .select('id, full_name, email, role, branch_id, active, employment_type, position_title, avatar_url')
      .eq('id', employeeId)
      .single()
    if (!employee || !(await canManageBranch(adminClient, user.id, adminProfile.role, adminProfile.branch_id, employee.branch_id))) {
      return response(404, { error: 'Không tìm thấy tài khoản trong chi nhánh được quản lý.' })
    }

    if (payload.action === 'reset_password') {
      if (employeeId === user.id) return response(400, { error: 'Không thể tự đặt lại mật khẩu từ màn nhân sự.' })
      const password = String(payload.password || payload.temporaryPassword || '')
      if (password.length < 6) return response(400, { error: 'Mật khẩu cần ít nhất 6 ký tự.' })
      const { error } = await adminClient.auth.admin.updateUserById(employeeId, { password })
      if (error) return response(400, { error: error.message })
      return response(200, { ok: true })
    }

    if (payload.action === 'delete') {
      if (employeeId === user.id) return response(400, { error: 'Không thể xóa tài khoản đang đăng nhập.' })
      const deletedEmail = `deleted-${employeeId}@accounts.invalid`
      const deletedPassword = crypto.randomUUID() + crypto.randomUUID()
      const { error: authError } = await adminClient.auth.admin.updateUserById(employeeId, {
        email: deletedEmail,
        password: deletedPassword,
        ban_duration: '876000h',
      })
      if (authError) return response(400, { error: authError.message })
      const { error: profileError } = await adminClient
        .from('profiles')
        .update({ active: false, email: null })
        .eq('id', employeeId)
      if (profileError) return response(400, { error: profileError.message })
      await adminClient
        .from('schedule_people')
        .update({ active: false })
        .eq('profile_id', employeeId)
      return response(200, { ok: true })
    }

    if (payload.action === 'hard_delete') {
      if (employeeId === user.id) return response(400, { error: 'Khong the xoa sach tai khoan dang dang nhap.' })
      await hardDeleteEmployee(adminClient, employeeId, adminProfile.id, true)
      return response(200, { ok: true })
    }

    if (payload.action === 'update') {
      const patch: Record<string, unknown> = {}
      if (payload.name !== undefined) {
        const name = String(payload.name || '').trim()
        if (!name) return response(400, { error: 'Tên nhân viên không hợp lệ.' })
        patch.full_name = name
      }
      if (payload.branchId !== undefined) {
        const branchId = String(payload.branchId || '')
        const branchName = String(payload.branchName || branchId).trim()
        if (!branchId) return response(400, { error: 'Vui lÃ²ng chá»n chi nhÃ¡nh cho nhÃ¢n viÃªn.' })
        if (!(await canManageBranch(adminClient, user.id, adminProfile.role, adminProfile.branch_id, branchId))) {
          return response(403, { error: 'Không có quyền chuyển nhân viên sang chi nhánh này.' })
        }
        const branchError = await ensureBranch(adminClient, branchId, branchName || branchId)
        if (branchError) return response(400, { error: branchError })
        await seedDefaultShifts(adminClient, branchId)
        patch.branch_id = branchId
      }
      if (payload.role !== undefined) {
        if (employeeId === user.id) return response(400, { error: 'Không thể tự hạ quyền Admin của chính mình.' })
        const role = String(payload.role || '')
        if (!['manager', 'shift_leader', 'staff', 'kitchen'].includes(role)) return response(400, { error: 'Vai trò không hợp lệ.' })
        patch.role = role
        if (role === 'manager' || role === 'kitchen') patch.branch_id = null
      }
      if (payload.employmentType !== undefined) {
        const employmentType = String(payload.employmentType || '')
        if (!['leader', 'full_time', 'part_time'].includes(employmentType)) return response(400, { error: 'Nhóm ca không hợp lệ.' })
        patch.employment_type = employmentType
      }
      if (payload.positionTitle !== undefined) patch.position_title = String(payload.positionTitle || '').trim()
      if (payload.avatarUrl !== undefined) {
        const avatarUrl = String(payload.avatarUrl || '').trim()
        if (avatarUrl && avatarUrl.length > 250000) return response(400, { error: 'Anh dai dien qua lon. Hay chon anh nho hon.' })
        patch.avatar_url = avatarUrl || null
      }
      if (!Object.keys(patch).length) return response(400, { error: 'Không có thông tin cần cập nhật.' })

      const { data: updated, error: profileError } = await adminClient
        .from('profiles')
        .update(patch)
        .eq('id', employeeId)
        .select('id, full_name, email, role, branch_id, active, employment_type, position_title, avatar_url')
        .single()
      if (profileError || !updated) return response(400, { error: profileError?.message || 'Không thể cập nhật hồ sơ nhân viên.' })
      const schedulePatch: Record<string, unknown> = {}
      if (patch.full_name !== undefined) schedulePatch.full_name = patch.full_name
      if (patch.branch_id !== undefined) schedulePatch.branch_id = patch.branch_id
      if (patch.employment_type !== undefined) schedulePatch.employment_type = patch.employment_type
      if (patch.position_title !== undefined) schedulePatch.position_title = patch.position_title
      if (Object.keys(schedulePatch).length) {
        await adminClient.from('schedule_people').update(schedulePatch).eq('profile_id', employeeId)
      }
      return response(200, {
        employee: {
          id: updated.id,
          name: updated.full_name,
          email: updated.email || undefined,
          role: updated.role,
          branchId: updated.branch_id,
          active: updated.active !== false,
          employmentType: updated.employment_type || undefined,
          positionTitle: updated.position_title || undefined,
          avatarUrl: updated.avatar_url || undefined,
        },
      })
    }

    return response(400, { error: 'Thao tác không hợp lệ.' })
  } catch (error) {
    return response(500, { error: error instanceof Error ? error.message : 'Lỗi máy chủ.' })
  }
})

async function canManageBranch(client: ReturnType<typeof createClient>, managerId: string, role: string, primaryBranchId: string, branchId: string) {
  if (role === 'admin') return true
  if (primaryBranchId === branchId) return true
  const { data } = await client
    .from('manager_branch_assignments')
    .select('branch_id')
    .eq('manager_id', managerId)
    .eq('branch_id', branchId)
    .maybeSingle()
  return Boolean(data)
}

async function ensureBranch(client: ReturnType<typeof createClient>, branchId: string, branchName: string) {
  const id = String(branchId || '').trim()
  const name = String(branchName || branchId || '').trim()
  if (!id || !name) return 'Chi nhÃ¡nh khÃ´ng há»£p lá»‡.'
  const { error } = await client
    .from('branches')
    .upsert({ id, name }, { onConflict: 'id' })
  return error?.message || ''
}

async function seedDefaultShifts(client: ReturnType<typeof createClient>, branchId: string) {
  try {
    const { error } = await client.rpc('seed_default_work_shifts', { p_branch_id: branchId })
    if (error) console.warn('seed_default_work_shifts failed', error.message)
  } catch (error) {
    console.warn('seed_default_work_shifts failed', error)
  }
}

async function hardDeleteBranch(
  client: ReturnType<typeof createClient>,
  branchId: string,
  profileIds: string[],
  replacementUserId: string,
) {
  const { data: receiptRows } = await client.from('sales_receipts').select('id').eq('branch_id', branchId)
  const receiptIds = (receiptRows || []).map((item: { id: string }) => item.id)
  if (receiptIds.length) await deleteMaybe(client, 'sales_receipt_items', (query) => query.in('receipt_id', receiptIds))
  await deleteMaybe(client, 'sales_receipts', (query) => query.eq('branch_id', branchId))

  const { data: sessionRows } = await client.from('bag_shift_sessions').select('id').eq('branch_id', branchId)
  const sessionIds = (sessionRows || []).map((item: { id: string }) => item.id)
  if (sessionIds.length) await updateMaybe(client, 'bag_allocations', { settlement_shift_id: null }, (query) => query.in('settlement_shift_id', sessionIds))
  await deleteMaybe(client, 'bag_allocations', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'bag_shift_sessions', (query) => query.eq('branch_id', branchId))

  await deleteMaybe(client, 'stock_movements', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'report_snapshots', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'inventory_reports', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'operation_days', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'supply_requests', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'attendance_records', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'shift_registrations', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'schedule_entries', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'schedule_people', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'payroll_entries', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'payroll_role_defaults', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'payroll_kpi_metrics', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'payroll_bonus_ledger', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'employee_kpi_targets', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'commission_rules', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'manager_branch_assignments', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'shifts', (query) => query.eq('branch_id', branchId))

  for (const profileId of profileIds) {
    await hardDeleteEmployee(client, profileId, replacementUserId, true)
  }
  await deleteMaybe(client, 'profiles', (query) => query.eq('branch_id', branchId))
  await deleteMaybe(client, 'branches', (query) => query.eq('id', branchId))
}

async function hardDeleteEmployee(
  client: ReturnType<typeof createClient>,
  employeeId: string,
  replacementUserId: string,
  deleteAuthUser: boolean,
) {
  await updateMaybe(client, 'sales_receipts', { seller_id: null }, (query) => query.eq('seller_id', employeeId))
  await updateMaybe(client, 'sales_receipts', { created_by: replacementUserId }, (query) => query.eq('created_by', employeeId))
  await updateMaybe(client, 'supply_requests', { requested_by: null }, (query) => query.eq('requested_by', employeeId))

  await updateMaybe(client, 'shift_registrations', { reviewed_by: null }, (query) => query.eq('reviewed_by', employeeId))
  await deleteMaybe(client, 'attendance_records', (query) => query.eq('user_id', employeeId))
  await deleteMaybe(client, 'shift_registrations', (query) => query.eq('user_id', employeeId))

  const { data: schedulePeople } = await client
    .from('schedule_people')
    .select('id')
    .eq('profile_id', employeeId)
  const schedulePersonIds = (schedulePeople || []).map((item: { id: string }) => item.id)
  if (schedulePersonIds.length) {
    await deleteMaybe(client, 'schedule_entries', (query) => query.in('person_id', schedulePersonIds))
    await deleteMaybe(client, 'schedule_people', (query) => query.in('id', schedulePersonIds))
  }
  await updateMaybe(client, 'schedule_entries', { updated_by: null }, (query) => query.eq('updated_by', employeeId))

  await updateMaybe(client, 'bag_shift_sessions', { leader_id: replacementUserId }, (query) => query.eq('leader_id', employeeId))
  await updateMaybe(client, 'bag_allocations', { issued_by: replacementUserId }, (query) => query.eq('issued_by', employeeId))
  await updateMaybe(client, 'bag_allocations', { settled_by: null }, (query) => query.eq('settled_by', employeeId))
  await updateMaybe(client, 'bag_allocations', { employee_id: null }, (query) => query.eq('employee_id', employeeId))

  await updateMaybe(client, 'stock_movements', { created_by: replacementUserId }, (query) => query.eq('created_by', employeeId))
  await updateMaybe(client, 'inventory_reports', { created_by: replacementUserId }, (query) => query.eq('created_by', employeeId))
  await updateMaybe(client, 'report_snapshots', { created_by: replacementUserId }, (query) => query.eq('created_by', employeeId))
  await updateMaybe(client, 'operation_days', { opened_by: replacementUserId }, (query) => query.eq('opened_by', employeeId))
  await updateMaybe(client, 'operation_days', { closed_by: null }, (query) => query.eq('closed_by', employeeId))
  await updateMaybe(client, 'shifts', { created_by: replacementUserId }, (query) => query.eq('created_by', employeeId))

  await deleteMaybe(client, 'payroll_entries', (query) => query.eq('employee_id', employeeId))
  await updateMaybe(client, 'employee_kpi_targets', { employee_id: null }, (query) => query.eq('employee_id', employeeId))
  await updateMaybe(client, 'employee_kpi_targets', { updated_by: null }, (query) => query.eq('updated_by', employeeId))
  await updateMaybe(client, 'payroll_kpi_metrics', { employee_id: null }, (query) => query.eq('employee_id', employeeId))
  await updateMaybe(client, 'payroll_bonus_ledger', { employee_id: null }, (query) => query.eq('employee_id', employeeId))
  await updateMaybe(client, 'payroll_bonus_ledger', { created_by: null }, (query) => query.eq('created_by', employeeId))
  await updateMaybe(client, 'commission_rules', { employee_id: null }, (query) => query.eq('employee_id', employeeId))
  await updateMaybe(client, 'commission_rules', { updated_by: null }, (query) => query.eq('updated_by', employeeId))
  await deleteMaybe(client, 'manager_branch_assignments', (query) => query.eq('manager_id', employeeId))
  await deleteMaybe(client, 'profiles', (query) => query.eq('id', employeeId))
  if (deleteAuthUser) {
    const { error: authError } = await client.auth.admin.deleteUser(employeeId)
    if (authError && !/not found|user not found/i.test(authError.message || '')) {
      throw authError
    }
  }
}

async function deleteMaybe(
  client: ReturnType<typeof createClient>,
  table: string,
  applyFilter: (query: any) => any,
) {
  const { error } = await applyFilter(client.from(table).delete())
  if (error && !isIgnorableSchemaError(error.message || '')) {
    throw error
  }
}

async function updateMaybe(
  client: ReturnType<typeof createClient>,
  table: string,
  patch: Record<string, unknown>,
  applyFilter: (query: any) => any,
) {
  const { error } = await applyFilter(client.from(table).update(patch))
  if (error && !isIgnorableSchemaError(error.message || '')) {
    throw error
  }
}

function isIgnorableSchemaError(message: string) {
  return /does not exist|schema cache|could not find|column .* does not exist|Could not find .* column/i.test(message)
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
}
