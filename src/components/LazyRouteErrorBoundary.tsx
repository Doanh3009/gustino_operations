import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class LazyRouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[lazy-route] Không tải được màn hình:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="page">
        <div className="section-card lazy-route-error" role="alert">
          <span className="eyebrow dark">GUSTINO ĐANG CẬP NHẬT</span>
          <h2>Không mở được màn hình này</h2>
          <p>Phiên bản mới chưa tải xong. Bấm nút dưới đây để lấy lại giao diện mới nhất.</p>
          <button className="primary-button" onClick={() => window.location.reload()}>Tải lại trang</button>
        </div>
      </section>
    )
  }
}
