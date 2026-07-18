import { Suspense, useCallback, useEffect, useState } from 'react'
import { AppShell, type InventoryTab, type Page } from './components/AppShell'
import { fetchMovements, loadLocalUser, saveLocalUser } from './lib/store'
import { shouldUseLanApi, supabase, uniqueChannelName } from './lib/supabase'
import { LauncherPage } from './pages/LauncherPage'
import { LoginPage } from './pages/LoginPage'
import type { AdminSection } from './pages/AdminPage'
import { canUseAdmin, canUseKitchen, canUseManagement, canUseOperations, canUseSales, normalizeRole } from './lib/access'
import { fetchConfiguredProducts, subscribeConfiguredProducts } from './lib/products'
import type { AppUser, StockMovement } from './types'
import { applyLanguageToDocument, useLang } from './lib/i18n'
import { CapyLoadingWindow } from './components/GlobalLoadingOverlay'
import { LazyRouteErrorBoundary } from './components/LazyRouteErrorBoundary'
import { lazyWithReload } from './lib/lazyRoute'

const InventoryPage = lazyWithReload(() => import('./pages/InventoryPage').then((module) => ({ default: module.InventoryPage })))
const ReportPage = lazyWithReload(() => import('./pages/ReportPage').then((module) => ({ default: module.ReportPage })))
const ReportArchivePage = lazyWithReload(() => import('./pages/ReportArchivePage').then((module) => ({ default: module.ReportArchivePage })))
const RestaurantPage = lazyWithReload(() => import('./pages/RestaurantPage').then((module) => ({ default: module.RestaurantPage })))
const SalesPage = lazyWithReload(() => import('./pages/SalesPage').then((module) => ({ default: module.SalesPage })))
const MyRecordsPage = lazyWithReload(() => import('./pages/MyRecordsPage').then((module) => ({ default: module.MyRecordsPage })))
const TodayPage = lazyWithReload(() => import('./pages/TodayPage').then((module) => ({ default: module.TodayPage })))
const AttendancePage = lazyWithReload(() => import('./pages/AttendancePage').then((module) => ({ default: module.AttendancePage })))
const ShiftHandoverPage = lazyWithReload(() => import('./pages/ShiftHandoverPage').then((module) => ({ default: module.ShiftHandoverPage })))
const ManagementPage = lazyWithReload(() => import('./pages/AdminPage').then((module) => ({ default: module.ManagementPage })))
const KitchenPage = lazyWithReload(() => import('./pages/KitchenPage').then((module) => ({ default: module.KitchenPage })))
const OrdersPage = lazyWithReload(() => import('./pages/OrdersPage').then((module) => ({ default: module.OrdersPage })))
const ManagerDashboardPage = lazyWithReload(() => import('./pages/ManagerDashboardPage').then((module) => ({ default: module.ManagerDashboardPage })))
const ControlCenterPage = lazyWithReload(() => import('./pages/ControlCenterPage').then((module) => ({ default: module.ControlCenterPage })))

function App() {
  const lang = useLang()
  const [user, setUser] = useState<AppUser | null>(() => {
    const saved = loadLocalUser()
    if (saved?.authToken && supabase && !shouldUseLanApi(saved)) return null
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
    const data = await fetchMovements(user.branchId, user)
    setMovements((current) => movementSignature(current) === movementSignature(data) ? current : data)
  }, [user])

  useEffect(() => {
    if (!supabase) return
    const saved = loadLocalUser()
    if (saved?.authToken && shouldUseLanApi(saved)) {
      setAuthReady(true)
      return
    }
    if (saved?.authToken) saveLocalUser(null)
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (!data.session) {
        setUser((current) => {
          if (current?.authToken) return current
          saveLocalUser(null)
          return null
        })
      }
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        setUser((current) => {
          if (current?.authToken) return current
          saveLocalUser(null)
          navigate('launcher')
          return null
        })
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
    if (!user || !needsMovements || !supabase || user.authToken) return
    const client = supabase
    const channel = client.channel(uniqueChannelName(`app-stock:${user.branchId}`))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'stock_movements',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refreshMovements())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'operation_days',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refreshMovements())
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [refreshMovements, needsMovements, user])
  useEffect(() => {
    // Menu/SKU dùng chung toàn hệ thống: kéo từ Supabase về và nghe realtime
    // để mọi thiết bị (ca trưởng, POS, kho, admin) nhìn cùng một danh mục.
    if (!user) return
    void fetchConfiguredProducts(user).catch(() => null)
    return subscribeConfiguredProducts(user, () => {
      void fetchConfiguredProducts(user).catch(() => null)
    })
  }, [user?.id, user?.authToken])
  useEffect(() => {
    if (!user || !supabase || user.authToken) return
    let active = true
    void (async () => {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, branch_id, active')
        .eq('id', user.id)
        .maybeSingle()
      if (!active || error) return
      const role = normalizeRole((profile?.role || user.role) as AppUser['role'])
      const branchId = profile?.branch_id || user.branchId
      let blocked = !profile || profile.active === false
      if ((role === 'staff' || role === 'shift_leader') && !branchId) blocked = true
      if (!blocked && (role === 'staff' || role === 'shift_leader')) {
        const { data: branch } = await supabase
          .from('branches')
          .select('id, active')
          .eq('id', branchId)
          .maybeSingle()
        blocked = !branch || branch.active === false
      }
      if (!active || !blocked) return
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
      saveLocalUser(null)
      setUser(null)
      navigate('launcher')
    })()
    return () => {
      active = false
    }
  }, [user?.id, user?.branchId, user?.role, user?.authToken])
  useEffect(() => {
    if (!user || !supabase || user.authToken || !canUseManagement(user.role)) return
    let active = true
    void (async () => {
      let nextBranchIds: string[] = []
      if (user.role === 'admin') {
        const { data } = await supabase
          .from('branches')
          .select('id')
          .eq('active', true)
        nextBranchIds = (data || []).map((item: { id: string }) => item.id)
      } else {
        const { data: assignments } = await supabase
          .from('manager_branch_assignments')
          .select('branch_id')
          .eq('manager_id', user.id)
        nextBranchIds = Array.from(new Set([
          user.branchId,
          ...((assignments || []) as Array<{ branch_id: string }>).map((item) => item.branch_id),
        ].filter(Boolean)))
      }
      if (!active || !nextBranchIds.length) return
      setUser((current) => {
        if (!current || current.id !== user.id) return current
        const nextBranchId = nextBranchIds.includes(current.branchId) ? current.branchId : nextBranchIds[0]
        const currentIds = [...(current.branchIds || [])].sort().join('|')
        const nextIds = [...nextBranchIds].sort().join('|')
        if (current.branchId === nextBranchId && currentIds === nextIds) return current
        const next = { ...current, branchId: nextBranchId, branchIds: nextBranchIds }
        saveLocalUser(next)
        return next
      })
    })()
    return () => {
      active = false
    }
  }, [user?.id, user?.role, user?.authToken])
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    const onProfileUpdated = (event: Event) => {
      const patch = (event as CustomEvent<Partial<AppUser> & { id?: string }>).detail
      if (!patch?.id) return
      setUser((current) => {
        if (!current || current.id !== patch.id) return current
        const next = { ...current, ...patch, role: normalizeRole(patch.role || current.role) }
        saveLocalUser(next)
        return next
      })
    }
    window.addEventListener('gustino:user-profile-updated', onProfileUpdated)
    return () => window.removeEventListener('gustino:user-profile-updated', onProfileUpdated)
  }, [])
  useEffect(() => {
    if (!user) return
    if (page === 'launcher') {
      navigate(defaultPageForRole(user))
      return
    }
    if (!canAccessPage(user, page)) navigate(defaultPageForRole(user))
  }, [page, user])
  useEffect(() => {
    window.requestAnimationFrame(() => applyLanguageToDocument(lang))
  }, [lang, page, user])

  function navigate(nextPage: Page, section?: string) {
    setPage(nextPage)
    setMgmtSection(nextPage === 'management' ? (section as AdminSection | undefined) : undefined)
    const nextHash = `#${nextPage}`
    if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash)
  }

  function handleLogin(nextUser: AppUser) {
    const normalizedUser = { ...nextUser, role: normalizeRole(nextUser.role) }
    setMovements([])
    saveLocalUser(normalizedUser)
    setUser(normalizedUser)
    navigate(defaultPageForRole(normalizedUser))
  }

  function openInventory(tab: InventoryTab) {
    setInventoryTab(tab)
    navigate('inventory')
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
    saveLocalUser(null)
    setUser(null)
    navigate('launcher')
  }

  if (!authReady) return <CapyLoadingWindow forced label="Đang kiểm tra phiên đăng nhập…" />
  if (!user) return <LoginPage onLogin={handleLogin} />
  if (!canAccessPage(user, page)) return <PageLoadFallback label="Đang chuyển đến màn hình phù hợp…" />
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
        <LazyRouteErrorBoundary key={page}>
          <Suspense fallback={<PageLoadFallback />}>
        {page === 'today' && <TodayPage user={user} movements={movements} onNavigate={navigate} onOpenInventory={openInventory} />}
        {page === 'dashboard' && canUseManagement(user.role) && <ManagerDashboardPage user={user} onNavigate={navigate} />}
        {page === 'sales' && <SalesPage user={user} onNavigate={navigate} />}
        {page === 'my-records' && <MyRecordsPage user={user} onNavigate={navigate} />}
        {page === 'report-archive' && <ReportArchivePage user={user} />}
        {page === 'restaurant' && <RestaurantPage user={user} movements={movements} />}
        {page === 'report' && <ReportPage user={user} movements={movements} onNavigate={navigate} onOpenInventory={openInventory} onRefresh={refreshMovements} />}
        {page === 'inventory' && (
          <InventoryPage
            user={user}
            movements={movements}
            onChanged={refreshMovements}
            initialTab={inventoryTab}
            onNavigate={navigate}
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
        {page === 'attendance' && <AttendancePage user={user} movements={movements} onNavigate={navigate} />}
        {page === 'management' && canUseManagement(user.role) && <ManagementPage user={user} initialSection={mgmtSection} />}
        {page === 'manager-revenue' && canUseManagement(user.role) && <ManagementPage user={user} initialSection="revenue" focused />}
        {page === 'manager-business' && canUseManagement(user.role) && <ManagementPage user={user} initialSection="commission" focused />}
        {page === 'manager-inventory' && canUseManagement(user.role) && <ManagementPage user={user} initialSection="inventory" focused />}
        {page === 'manager-attendance' && canUseAdmin(user.role) && <ManagementPage user={user} initialSection="attendance" focused />}
        {page === 'manager-payroll' && canUseAdmin(user.role) && <ManagementPage user={user} initialSection="payroll" focused />}
        {page === 'manager-requests' && canUseAdmin(user.role) && <ManagementPage user={user} initialSection="requests" focused />}
        {page === 'admin-accounts' && canUseAdmin(user.role) && <ManagementPage user={user} initialSection="accounts" focused />}
        {page === 'control' && canUseAdmin(user.role) && <ControlCenterPage user={user} />}
        {page === 'kitchen' && canUseKitchen(user.role) && <KitchenPage user={user} />}
          </Suspense>
        </LazyRouteErrorBoundary>
      </div>
    </AppShell>
  )
}

function PageLoadFallback({ label = 'Đang mở màn hình…' }: { label?: string }) {
  return <CapyLoadingWindow forced label={label} />
}

function pageFromHash(): Page {
  const candidate = window.location.hash.replace('#', '')
  if (candidate === 'history') return 'orders'
  if (candidate === 'admin') return 'management'
  return [
    'launcher',
    'dashboard',
    'today',
    'sales',
    'my-records',
    'report-archive',
    'restaurant',
    'report',
    'inventory',
    'handover',
    'orders',
    'attendance',
    'management',
    'manager-revenue',
    'manager-business',
    'manager-inventory',
    'manager-attendance',
    'manager-payroll',
    'manager-requests',
    'admin-accounts',
    'control',
    'kitchen',
  ].includes(candidate)
    ? candidate as Page
    : 'launcher'
}

export default App

function movementSignature(items: StockMovement[]) {
  return items.map((item) => `${item.id}:${item.createdAt}:${item.quantity}`).join('|')
}

function canAccessPage(user: AppUser, page: Page) {
  if (page === 'launcher') return true
  if (page === 'attendance') return user.role !== 'kitchen' && user.role !== 'manager'
  if (page === 'dashboard') return canUseManagement(user.role)
  if (page === 'sales') return canUseSales(user.role)
  if (page === 'my-records') return user.role === 'staff' || user.role === 'shift_leader'
  if (page === 'report-archive') return canUseAdmin(user.role)
  if (page === 'inventory') return canUseOperations(user.role)
  if (page === 'management') return canUseManagement(user.role)
  if (page === 'manager-attendance' || page === 'manager-payroll') return canUseAdmin(user.role)
  if (page === 'manager-requests') return canUseAdmin(user.role)
  if (['manager-revenue', 'manager-business', 'manager-inventory'].includes(page)) return canUseManagement(user.role)
  if (page === 'admin-accounts') return canUseAdmin(user.role)
  if (page === 'control') return canUseAdmin(user.role)
  if (page === 'kitchen') return canUseKitchen(user.role)
  return canUseOperations(user.role)
}

function defaultPageForRole(user: AppUser): Page {
  if (user.role === 'kitchen') return 'kitchen'
  if (user.role === 'staff') return 'sales'
  if (canUseManagement(user.role)) return 'dashboard'
  if (canUseOperations(user.role)) return 'today'
  return 'attendance'
}
