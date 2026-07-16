import { branchName } from '../lib/branches'
import { calculateStock } from '../lib/store'
import type { StockMovement, AppUser } from '../types'
import type { Page } from '../components/AppShell'

interface Props {
  user: AppUser
  movements: StockMovement[]
  onNavigate: (page: Page) => void
}

export function HomePage({ user, movements, onNavigate }: Props) {
  const currentBranchName = branchName(user.branchId)
  const stock = calculateStock(movements)
  const lowStock = stock.filter((line) => line.expected <= line.product.lowStock)
  const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  })

  return (
    <div className="page home-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">TRUNG TÂM VẬN HÀNH</span>
          <h1>Xin chào, {user.name}</h1>
          <p>{currentBranchName} · {today}</p>
        </div>
        <span className="sync-pill"><i /> Dữ liệu đã đồng bộ</span>
      </div>

      <section className="hero-banner">
        <div>
          <span>CA LÀM VIỆC HÔM NAY</span>
          <h2>Sẵn sàng bắt đầu?</h2>
          <p>Chọn công việc cần thực hiện. Dữ liệu kho và báo cáo ca sẽ tự động liên kết.</p>
        </div>
        <div className="banner-orbit"><span><img src="/gustino-logo.jpg" alt="GUSTINO" /></span></div>
      </section>

      <div className="feature-grid">
        <button className="feature-card restaurant-card" onClick={() => onNavigate('restaurant')}>
          <span className="feature-icon">◇</span>
          <span className="feature-tag">CHI NHÁNH</span>
          <h3>Bảng điều khiển nhà hàng</h3>
          <p>Tổng quan doanh thu, lượng hàng, hao hụt và cảnh báo tồn kho.</p>
          <strong>Xem hoạt động <span>→</span></strong>
        </button>
        <button className="feature-card report-card" onClick={() => onNavigate('report')}>
          <span className="feature-icon">▤</span>
          <span className="feature-tag">CUỐI NGÀY</span>
          <h3>Báo cáo chốt ca</h3>
          <p>PG, doanh thu, KPI, hao hụt, sự cố và xuất infographic.</p>
          <strong>Mở báo cáo <span>→</span></strong>
        </button>
        <button className="feature-card inventory-card" onClick={() => onNavigate('inventory')}>
          <span className="feature-icon">▦</span>
          <span className="feature-tag">TRONG CA</span>
          <h3>Quản lý kho</h3>
          <p>Nhập hàng, chế biến, xuất bán và kiểm kê tồn cuối ca.</p>
          <strong>Vào kiểm kho <span>→</span></strong>
        </button>
      </div>

      <section className="section-card">
        <div className="section-title">
          <div><span className="eyebrow dark">TỔNG QUAN NHANH</span><h2>Tình trạng kho</h2></div>
          <button className="text-button" onClick={() => onNavigate('inventory')}>Xem chi tiết →</button>
        </div>
        <div className="stats-grid">
          <div className="stat-card"><span>Mặt hàng theo dõi</span><strong>{stock.length}</strong><small>Danh mục đang hoạt động</small></div>
          <div className="stat-card warning"><span>Sắp hết hàng</span><strong>{lowStock.length}</strong><small>Cần kiểm tra hoặc nhập thêm</small></div>
          <div className="stat-card"><span>Giao dịch hôm nay</span><strong>{movements.filter((m) => m.shiftDate === new Date().toISOString().slice(0, 10)).length}</strong><small>Nhập, xuất và kiểm kê</small></div>
        </div>
      </section>
    </div>
  )
}
