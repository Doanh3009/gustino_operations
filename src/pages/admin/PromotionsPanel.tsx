import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteProductPromotion,
  fetchProductPromotions,
  promotionCoversDate,
  saveProductPromotion,
  setActivePromotions,
  type ProductPromotion,
} from '../../lib/promotions'
import { configuredProductPrice, getSaleProducts } from '../../lib/constants'
import { localDateKey } from '../../lib/dates'
import {
  DataHead,
  DataList,
  DataRow,
  Drawer,
  EmptyState,
  SectionHeader,
  StatusBadge,
  SummaryLine,
  Surface,
} from '../../components/ui'
import type { AppUser, Branch } from '../../types'

/**
 * KHUYẾN MÃI / GIẢM GIÁ — màn cấu hình no-code cho Admin.
 *
 * Đây là câu trả lời cho việc phải sửa tay `sales_receipt_items` đợt bánh hạt dẻ
 * 06–13/08/2026: đặt một chương trình ở đây là POS bán đúng giá ngay, hết hạn là
 * giá tự quay về mức niêm yết, và KHÔNG dòng hóa đơn nào của quá khứ bị đụng tới.
 */

interface Props {
  user: AppUser
  branches: Branch[]
}

const EMPTY: ProductPromotion = {
  id: '',
  productId: '',
  branchId: undefined,
  name: '',
  promoPrice: undefined,
  discountPercent: undefined,
  startsOn: localDateKey(),
  endsOn: undefined,
  active: true,
  note: '',
}

function formatMoney(value?: number) {
  return typeof value === 'number' ? `${Math.round(value).toLocaleString('vi-VN')}đ` : '—'
}

function formatDate(value?: string) {
  const [year, month, day] = String(value || '').split('-')
  return day && month && year ? `${day}/${month}/${year}` : '—'
}

export function PromotionsPanel({ user, branches }: Props) {
  const editable = user.role === 'admin'
  const today = localDateKey()
  const [rows, setRows] = useState<ProductPromotion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<ProductPromotion | null>(null)
  const [kind, setKind] = useState<'price' | 'percent'>('price')

  const products = useMemo(() => getSaleProducts().slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')), [rows])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchProductPromotions(user)
      setRows(next)
      setActivePromotions(next)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không đọc được danh sách khuyến mãi.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { void load() }, [load])

  const running = rows.filter((row) => promotionCoversDate(row, today))

  async function save() {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const payload: ProductPromotion = {
        ...draft,
        promoPrice: kind === 'price' ? draft.promoPrice : undefined,
        discountPercent: kind === 'percent' ? draft.discountPercent : undefined,
      }
      await saveProductPromotion(user, payload)
      await load()
      setDraft(null)
      setFeedback('Đã lưu chương trình. POS ngoài quầy đổi giá ngay.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không lưu được chương trình.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: ProductPromotion) {
    const productName = products.find((item) => item.id === row.productId)?.name || row.productId
    if (!window.confirm(`Xóa chương trình khuyến mãi cho "${productName}"?\n\nGiá sẽ quay về mức niêm yết. Hóa đơn đã bán giữ nguyên giá đã ghi.`)) return
    setBusy(true)
    try {
      await deleteProductPromotion(user, row.id)
      await load()
      setFeedback('Đã xóa chương trình. Giá quay về mức niêm yết.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không xóa được chương trình.')
    } finally {
      setBusy(false)
    }
  }

  function previewPrice(row: ProductPromotion) {
    const base = configuredProductPrice(row.productId, 0)
    if (typeof row.promoPrice === 'number') return row.promoPrice
    if (typeof row.discountPercent === 'number') return Math.round(base * (100 - row.discountPercent) / 100)
    return base
  }

  return (
    <Surface>
      <SectionHeader
        title="Khuyến mãi & giảm giá"
        description="Đặt giá bán theo giai đoạn. Hết hạn giá tự về mức niêm yết; hóa đơn đã bán không bị sửa."
        count={`${running.length} đang chạy`}
        aside={editable
          ? <button type="button" className="gt-btn gt-btn--primary gt-btn--sm" onClick={() => { setKind('price'); setDraft({ ...EMPTY }) }}>+ Chương trình</button>
          : undefined}
      />

      {error && <div className="gt-pad"><div className="gt-callout gt-callout--bad"><strong>{error}</strong></div></div>}
      {feedback && <div className="gt-pad"><div className="gt-callout gt-callout--info"><strong>{feedback}</strong></div></div>}

      <div className="gt-pad">
        <SummaryLine items={[
          { text: `${rows.length} chương trình` },
          { text: `${running.length} đang chạy`, tone: running.length ? undefined : 'warn' },
          { text: `${rows.filter((row) => !row.active).length} đã tắt` },
        ]} />
      </div>

      <DataList columns="minmax(0, 1.8fr) minmax(0, 1fr) minmax(0, 1.2fr) 108px 132px">
        <DataHead>
          <span>Sản phẩm</span>
          <span className="gt-cell--num">Giá KM</span>
          <span>Thời gian</span>
          <span>Trạng thái</span>
          <span />
        </DataHead>
        {rows.map((row) => {
          const product = products.find((item) => item.id === row.productId)
          const base = configuredProductPrice(row.productId, 0)
          const active = promotionCoversDate(row, today)
          return (
            <DataRow key={row.id}>
              <span data-gt-primary>
                <strong>{product?.name || row.productId}</strong>
                <small>
                  {row.branchId ? branches.find((item) => item.id === row.branchId)?.name || row.branchId : 'Tất cả chi nhánh'}
                  {row.name ? ` · ${row.name}` : ''}
                </small>
              </span>
              <span className="gt-cell--num" data-gt-label="Giá KM">
                <b>{formatMoney(previewPrice(row))}</b>
                {base > 0 && <small style={{ textDecoration: 'line-through' }}>{formatMoney(base)}</small>}
              </span>
              <span data-gt-label="Thời gian">
                {formatDate(row.startsOn)} → {row.endsOn ? formatDate(row.endsOn) : 'không hạn'}
              </span>
              <span data-gt-label="Trạng thái">
                {!row.active
                  ? <StatusBadge tone="neutral">Đã tắt</StatusBadge>
                  : active
                    ? <StatusBadge tone="good">Đang chạy</StatusBadge>
                    : row.startsOn > today
                      ? <StatusBadge tone="info">Sắp chạy</StatusBadge>
                      : <StatusBadge tone="neutral">Đã kết thúc</StatusBadge>}
              </span>
              <span data-gt-trailing>
                {editable && (
                  <>
                    <button type="button" className="gt-btn gt-btn--secondary gt-btn--sm" onClick={() => { setKind(typeof row.discountPercent === 'number' ? 'percent' : 'price'); setDraft({ ...row }) }}>Sửa</button>
                    <button type="button" className="gt-btn gt-btn--ghost gt-btn--sm" disabled={busy} onClick={() => void remove(row)}>Xóa</button>
                  </>
                )}
              </span>
            </DataRow>
          )
        })}
        {!loading && !rows.length && (
          <EmptyState
            title="Chưa có chương trình nào"
            description="Tạo một chương trình để hạ giá một mặt hàng trong một giai đoạn, thay vì sửa giá gốc."
          />
        )}
        {loading && <EmptyState title="Đang tải…" />}
      </DataList>

      <Drawer
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Sửa chương trình' : 'Chương trình khuyến mãi'}
        subtitle="Giá này chỉ áp cho hóa đơn bán TRONG kỳ. Hóa đơn cũ giữ nguyên giá đã ghi."
        footer={
          <>
            <button type="button" className="gt-btn gt-btn--secondary" onClick={() => setDraft(null)} disabled={busy}>Hủy</button>
            <button type="button" className="gt-btn gt-btn--primary" onClick={() => void save()} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu chương trình'}</button>
          </>
        }
      >
        {draft && (
          <>
            <label className="gt-field" style={{ width: '100%' }}>
              <span>Sản phẩm</span>
              <select value={draft.productId} onChange={(event) => setDraft({ ...draft, productId: event.target.value })}>
                <option value="">Chọn sản phẩm</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — {formatMoney(configuredProductPrice(product.id, 0))}
                  </option>
                ))}
              </select>
            </label>

            <label className="gt-field" style={{ width: '100%' }}>
              <span>Chi nhánh</span>
              <select value={draft.branchId || ''} onChange={(event) => setDraft({ ...draft, branchId: event.target.value || undefined })}>
                <option value="">Tất cả chi nhánh</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>

            <div>
              <span className="gt-metric__label">Cách giảm</span>
              <div className="gt-viewswitch" style={{ marginTop: 6 }}>
                <button type="button" className={kind === 'price' ? 'is-active' : ''} onClick={() => setKind('price')}>Giá cố định</button>
                <button type="button" className={kind === 'percent' ? 'is-active' : ''} onClick={() => setKind('percent')}>Giảm %</button>
              </div>
            </div>

            {kind === 'price' ? (
              <label className="gt-field" style={{ width: '100%' }}>
                <span>Giá KM</span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={draft.promoPrice ?? ''}
                  placeholder="29900"
                  onChange={(event) => setDraft({ ...draft, promoPrice: event.target.value === '' ? undefined : Number(event.target.value) })}
                />
              </label>
            ) : (
              <label className="gt-field" style={{ width: '100%' }}>
                <span>Giảm %</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={draft.discountPercent ?? ''}
                  placeholder="15"
                  onChange={(event) => setDraft({ ...draft, discountPercent: event.target.value === '' ? undefined : Number(event.target.value) })}
                />
              </label>
            )}

            {draft.productId && (
              <div className="gt-callout gt-callout--info">
                <strong>
                  {formatMoney(configuredProductPrice(draft.productId, 0))} → {formatMoney(previewPrice(draft))}
                </strong>
                <p>Đây là giá nhân viên sẽ thấy trên POS trong kỳ khuyến mãi.</p>
              </div>
            )}

            <div className="gt-filterbar__group">
              <label className="gt-field">
                <span>Từ ngày</span>
                <input type="date" value={draft.startsOn} onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })} />
              </label>
              <label className="gt-field">
                <span>Đến ngày</span>
                <input type="date" value={draft.endsOn || ''} min={draft.startsOn} onChange={(event) => setDraft({ ...draft, endsOn: event.target.value || undefined })} />
              </label>
            </div>
            <p className="gt-metric__hint">Để trống “Đến ngày” = chạy tới khi tắt bằng tay.</p>

            <label className="gt-field" style={{ width: '100%' }}>
              <span>Tên</span>
              <input
                type="text"
                maxLength={200}
                placeholder="VD: Khuyến mãi bánh hạt dẻ tháng 8"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
              Đang bật
            </label>
          </>
        )}
      </Drawer>
    </Surface>
  )
}
