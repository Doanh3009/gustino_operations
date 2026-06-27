import { useCallback, useEffect, useState } from 'react'
import { AppShell, type InventoryTab, type Page } from './components/AppShell'
import { fetchMovements, loadLocalUser, saveLocalUser } from './lib/store'
import { supabase } from './lib/supabase'
import { InventoryPage } from './pages/InventoryPage'
import { LauncherPage } from './pages/LauncherPage'
import { LoginPage } from './pages/LoginPage'
import { ReportPage } from './pages/ReportPage'
import { RestaurantPage } from './pages/RestaurantPage'
import { SalesPage } from './pages/SalesPage'
import { TodayPage } from './pages/TodayPage'
import { AttendancePage } from './pages/AttendancePage'
import { ShiftHandoverPage } from './pages/ShiftHandoverPage'
import { ManagementPage, type AdminSection } from './pages/AdminPage'
import { canUseKitchen, canUseManagement, canUseOperations, canUseSales, normalizeRole } from './lib/access'
import type { AppUser, StockMovement } from './types'
import { KitchenPage } from './pages/KitchenPage'
import { OrdersPage } from './pages/OrdersPage'
import { ManagerDashboardPage } from './pages/ManagerDashboardPage'

function App() {
  const [user, setUser] = useState<AppUser | null>(() => {
    const saved = loadLocalUser()
    return saved ? { ...saved, role: normalizeRole(saved.role) } : null
  })
  const [page, setPage] = useState<Page>(() => pageFromHash())
  const [authReady, setAuthReady] = useState(!supabase)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>('overview')
  const [mgmtSection, setMgmtSection] = useState<AdminSection | undefined>(undefined)
  const needsMovements = ['today', 'restaurant', 'report', 'inventory', 'handover', 'orders'].includes(page)

  const refreshMovements = useCallback(async () => {
    if (!user) return
    const data = await fetchMovements(user.branchId)
    setMovements((current) => movementSignature(current) === movementSignature(data) ? current : data)
  }, [user])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (!data.session) {
        saveLocalUser(null)
        setUser(null)
      }
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        saveLocalUser(null)
        setUser(null)
        navigate('launcher')
      }
      setAuthReady(true)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (needsMovements) void refreshMovements()
  }, [needsMovements, refreshMovements])
  useEffect(() => {
    if (!user || !needsMovements) return
    const timer = window.setInterval(() => void refreshMovements(), 15000)
    return () => window.clearInterval(timer)
  }, [refreshMovements, needsMovements, user])
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    if (!user) return
    if (!canAccessPage(user, page)) navigate(user.role === 'kitchen' ? 'kitchen' : user.role === 'staff' ? 'attendance' : canUseManagement(user.role) ? 'dashboard' : 'launcher')
  }, [page, user])

  function navigate(nextPage: Page, section?: string) {
    setPage(nextPage)
    setMgmtSection(nextPage === 'management' ? (section as AdminSection | undefined) : undefined)
    const nextHash = `#${nextPage}`
    if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash)
  }

  function handleLogin(nextUser: AppUser) {
    const normalizedUser = { ...nextUser, role: normalizeRole(nextUser.role) }
    saveLocalUser(normalizedUser)
    setUser(normalizedUser)
    if (normalizedUser.role === 'kitchen') navigate('kitchen')
    else if (canUseManagement(normalizedUser.role)) navigate('dashboard')
    else navigate('launcher')
  }

  function openInventory(tab: InventoryTab) {
    setInventoryTab(tab)
    navigate('inventory')
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut().catch(() => null)
    saveLocalUser(null)
    setUser(null)
    navigate('launcher')
  }

  if (!authReady) return <div className="login-page"><section className="login-panel"><div className="login-card">Đang kiểm tra phiên đăng nhập…</div></section></div>
  if (!user) return <LoginPage onLogin={handleLogin} />
  if (!canAccessPage(user, page)) return null
  if (page === 'launcher') {
    return (
      <LauncherPage
        user={user}
        onOpenOperations={() => navigate('today')}
        onOpenSales={() => navigate('sales')}
        onOpenAttendance={() => navigate('attendance')}
        onOpenManagement={() => navigate('management')}
        onOpenKitchen={() => navigate('kitchen')}
        onLogout={logout}
      />
    )
  }

  return (
    <AppShell user={user} page={page} currentSection={mgmtSection} onNavigate={navigate} onLogout={logout}>
      <div key={page} className="page-transition">
        {page === 'today' && <TodayPage user={user} movements={movements} onNavigate={navigate} onOpenInventory={openInventory} />}
        {page === 'dashboard' && canUseManagement(user.role) && <ManagerDashboardPage user={user} onNavigate={navigate} />}
        {page === 'sales' && <SalesPage user={user} onNavigate={navigate} />}
        {page === 'restaurant' && <RestaurantPage user={user} movements={movements} />}
        {page === 'report' && <ReportPage user={user} movements={movements} onNavigate={navigate} onOpenInventory={openInventory} onRefresh={refreshMovements} />}
        {page === 'inventory' && (
          <InventoryPage
            user={user}
            movements={movements}
            onChanged={refreshMovements}
            onOpenHandover={() => navigate('handover')}
            initialTab={inventoryTab}
          />
        )}
        {page === 'handover' && (
          <ShiftHandoverPage
            user={user}
            movements={movements}
            onChanged={refreshMovements}
            onNavigate={navigate}
          />
        )}
        {page === 'orders' && <OrdersPage user={user} movements={movements} />}
        {page === 'attendance' && <AttendancePage user={user} onNavigate={navigate} />}
        {page === 'management' && canUseManagement(user.role) && <ManagementPage user={user} initialSection={mgmtSection} />}
        {page === 'kitchen' && canUseKitchen(user.role) && <KitchenPage user={user} />}
      </div>
    </AppShell>
  )
}

function pageFromHash(): Page {
  const candidate = window.location.hash.replace('#', '')
  if (candidate === 'history') return 'orders'
  if (candidate === 'admin') return 'management'
  return ['launcher', 'dashboard', 'today', 'sales', 'restaurant', 'report', 'inventory', 'handover', 'orders', 'attendance', 'management', 'kitchen'].includes(candidate)
    ? candidate as Page
    : 'launcher'
}

export default App

function movementSignature(items: StockMovement[]) {
  return items.map((item) => `${item.id}:${item.createdAt}:${item.quantity}`).join('|')
}

function canAccessPage(user: AppUser, page: Page) {
  if (page === 'launcher') return true
  if (page === 'attendance') return user.role !== 'kitchen'
  if (page === 'dashboard') return canUseManagement(user.role)
  if (page === 'sales') return canUseSales(user.role)
  if (page === 'management') return canUseManagement(user.role)
  if (page === 'kitchen') return canUseKitchen(user.role)
  return canUseOperations(user.role)
}
