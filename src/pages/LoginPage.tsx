import { useState } from 'react'
import { BRANCHES } from '../lib/constants'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { AppUser, Role } from '../types'
import { normalizeRole } from '../lib/access'
import { usernameToEmail } from '../lib/authIdentity'
import { AppFooter } from '../components/AppFooter'

interface Props {
  onLogin: (user: AppUser) => void
}

const LEGACY_ACCOUNT_DOMAIN = 'gustino.vn'

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [branchId] = useState(BRANCHES[0].id)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const cleanPassword = password.trim()
      if (cleanPassword.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.')

      if (supabase && isSupabaseConfigured) {
        let email = usernameToEmail(username)
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
        let { data, error: authError } = await supabase.auth.signInWithPassword({ email, password: cleanPassword })
        if (authError && !username.includes('@') && authError.message.toLowerCase().includes('invalid login')) {
          const legacyEmail = `${username.trim().toLowerCase()}@${LEGACY_ACCOUNT_DOMAIN}`
          const legacyResult = await supabase.auth.signInWithPassword({ email: legacyEmail, password: cleanPassword })
          if (!legacyResult.error) {
            email = legacyEmail
            data = legacyResult.data
            authError = null
          }
        }
        if (authError) throw new Error(
          authError.message.toLowerCase().includes('invalid login')
            ? 'Tên đăng nhập hoặc mật khẩu không đúng.'
            : authError.message,
        )
        if (!data.user) throw new Error('Không thể đăng nhập. Vui lòng thử lại.')
        const metadata = data.user.user_metadata
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, role, branch_id, employment_type, position_title')
          .eq('id', data.user.id)
          .maybeSingle()
        let branchIds: string[] = []
        if ((profile?.role || metadata.role) === 'manager') {
          const { data: assignments } = await supabase
            .from('manager_branch_assignments')
            .select('branch_id')
            .eq('manager_id', data.user.id)
          branchIds = (assignments || []).map((item) => item.branch_id)
        }
        onLogin({
          id: data.user.id,
          name: profile?.full_name || metadata.full_name || username,
          email,
          role: normalizeRole((profile?.role || metadata.role || 'shift_leader') as Role),
          branchId: profile?.branch_id || metadata.branch_id || branchId,
          branchIds,
          employmentType: profile?.employment_type || undefined,
          positionTitle: profile?.position_title || undefined,
        })
      } else {
        const response = await fetch('/api/attendance/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: cleanPassword }),
        })
        const account = await response.json().catch(() => null)
        if (!response.ok) {
          const apiOffline = !account?.error && response.status >= 500
          throw new Error(apiOffline ? apiOfflineMessage() : account?.error || 'Tên đăng nhập hoặc mật khẩu không đúng.')
        }
        onLogin({
          id: account.id,
          name: account.name,
          email: account.email,
          role: normalizeRole(account.role as Role),
          branchId: account.branchId,
          branchIds: account.branchIds || [account.branchId],
          authToken: account.authToken,
          employmentType: account.employmentType,
          positionTitle: account.positionTitle,
        })
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể đăng nhập'
      setError(
        message === 'Failed to fetch' || message === 'NetworkError when attempting to fetch resource.'
          ? apiOfflineMessage()
          : message,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="hero-glow" />
        <div className="login-brand">
          <span className="brand-mark large">G</span>
          <div><strong>GUSTINO</strong><small>VẬN HÀNH CHÍNH THỨC</small></div>
        </div>
        <div className="hero-copy">
          <span className="eyebrow">TRANG CHỦ</span>
          <h1>Chúc một ngày tốt lành.</h1>
          <p>Đăng nhập để bắt đầu ca làm, ghi nhận đúng việc và bàn giao gọn.</p>
          <div className="hero-points">
            <span>Báo cáo rõ</span>
            <span>Kho không lệch</span>
            <span>Ca làm minh bạch</span>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <div>
            <span className="eyebrow dark">CHÀO MỪNG TRỞ LẠI</span>
            <h2>Đăng nhập hệ thống</h2>
            <p>Sử dụng tài khoản được quản lý cấp.</p>
          </div>
          <label>Tên đăng nhập
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required />
          </label>
          <label>Mật khẩu
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="password-visibility">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
            Hiện mật khẩu
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button wide" disabled={loading}>
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập →'}
          </button>
          <small className="login-help">Cần hỗ trợ? Liên hệ quản lý hệ thống.</small>
        </form>
      </section>
      <AppFooter />
    </div>
  )
}

function apiOfflineMessage() {
  return 'Máy chủ chưa sẵn sàng. Vui lòng tải lại trang hoặc báo quản lý hệ thống.'
}
