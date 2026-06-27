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

    const { data: manager } = await adminClient
      .from('profiles')
      .select('id, role, branch_id, active')
      .eq('id', user.id)
      .single()
    if (!manager || manager.role !== 'manager' || manager.active === false) {
      return response(403, { error: 'Chỉ quản lý được quản lý tài khoản nhân viên.' })
    }

    const payload = await request.json()
    if (payload.action === 'create') {
      const name = String(payload.name || '').trim()
      const username = normalizeUsername(String(payload.username || ''))
      const email = String(payload.email || '').trim().toLowerCase()
      const password = String(payload.password || payload.temporaryPassword || '')
      const branchId = String(payload.branchId || '')
      const role = String(payload.role || 'staff')
      const employmentType = String(payload.employmentType || (role === 'shift_leader' ? 'leader' : 'part_time'))
      const positionTitle = String(payload.positionTitle || '').trim()
      if (!name || username.length < 3 || !email.includes('@')) return response(400, { error: 'Tên và tên đăng nhập không hợp lệ.' })
      if (password.length < 6) return response(400, { error: 'Mật khẩu cần ít nhất 6 ký tự.' })
      if (!['manager', 'shift_leader', 'staff', 'kitchen'].includes(role)) return response(400, { error: 'Vai trò không hợp lệ.' })
      if (!['leader', 'full_time', 'part_time'].includes(employmentType)) return response(400, { error: 'Nhóm ca không hợp lệ.' })
      if (!(await canManageBranch(adminClient, user.id, manager.branch_id, branchId))) {
        return response(403, { error: 'Không có quyền tạo tài khoản tại chi nhánh này.' })
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
      })
      if (profileError) {
        await adminClient.auth.admin.deleteUser(created.user.id)
        return response(400, { error: profileError.message })
      }
      return response(200, {
        employee: { id: created.user.id, name, email, username, role, branchId, active: true, employmentType, positionTitle },
      })
    }

    const employeeId = String(payload.employeeId || '')
    if (!employeeId || employeeId === user.id) return response(400, { error: 'Tài khoản không hợp lệ.' })
    const { data: employee } = await adminClient
      .from('profiles')
      .select('id, full_name, email, role, branch_id, active, employment_type, position_title')
      .eq('id', employeeId)
      .single()
    if (!employee || !(await canManageBranch(adminClient, user.id, manager.branch_id, employee.branch_id))) {
      return response(404, { error: 'Không tìm thấy tài khoản trong chi nhánh được quản lý.' })
    }

    if (payload.action === 'reset_password') {
      const password = String(payload.password || payload.temporaryPassword || '')
      if (password.length < 6) return response(400, { error: 'Mật khẩu cần ít nhất 6 ký tự.' })
      const { error } = await adminClient.auth.admin.updateUserById(employeeId, { password })
      if (error) return response(400, { error: error.message })
      return response(200, { ok: true })
    }

    if (payload.action === 'delete') {
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
        if (!(await canManageBranch(adminClient, user.id, manager.branch_id, branchId))) {
          return response(403, { error: 'Không có quyền chuyển nhân viên sang chi nhánh này.' })
        }
        patch.branch_id = branchId
      }
      if (payload.role !== undefined) {
        const role = String(payload.role || '')
        if (!['manager', 'shift_leader', 'staff', 'kitchen'].includes(role)) return response(400, { error: 'Vai trò không hợp lệ.' })
        patch.role = role
      }
      if (payload.employmentType !== undefined) {
        const employmentType = String(payload.employmentType || '')
        if (!['leader', 'full_time', 'part_time'].includes(employmentType)) return response(400, { error: 'Nhóm ca không hợp lệ.' })
        patch.employment_type = employmentType
      }
      if (payload.positionTitle !== undefined) patch.position_title = String(payload.positionTitle || '').trim()
      if (!Object.keys(patch).length) return response(400, { error: 'Không có thông tin cần cập nhật.' })

      const { data: updated, error: profileError } = await adminClient
        .from('profiles')
        .update(patch)
        .eq('id', employeeId)
        .select('id, full_name, email, role, branch_id, active, employment_type, position_title')
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
        },
      })
    }

    return response(400, { error: 'Thao tác không hợp lệ.' })
  } catch (error) {
    return response(500, { error: error instanceof Error ? error.message : 'Lỗi máy chủ.' })
  }
})

async function canManageBranch(client: ReturnType<typeof createClient>, managerId: string, primaryBranchId: string, branchId: string) {
  if (primaryBranchId === branchId) return true
  const { data } = await client
    .from('manager_branch_assignments')
    .select('branch_id')
    .eq('manager_id', managerId)
    .eq('branch_id', branchId)
    .maybeSingle()
  return Boolean(data)
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
