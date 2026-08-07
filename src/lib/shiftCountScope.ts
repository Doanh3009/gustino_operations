/**
 * Thành phẩm nào phải đếm khi chốt ca — và thế nào là "đã đếm".
 *
 * Đây chính là chỗ sinh ra lỗi kho âm triền miên (chẩn đoán DB 06/08/2026):
 * bản cũ chỉ đưa vào màn đếm những SKU có tồn **> 0** trên bản `Math.max(0, …)`,
 * nên SKU nào rơi xuống âm là bị loại khỏi màn đếm ⇒ không bao giờ có mốc kiểm kê
 * ⇒ kẹt âm vĩnh viễn. Bằng chứng: *Thành phẩm hạt dẻ nướng* bị POS trừ 58,96 kg ở
 * Gold Coast với đúng 0 lần kiểm kê.
 *
 * Tách khỏi trang để test được bằng số, không phải test bằng mắt.
 */

/** Nửa đơn vị cuối của `stock_movements.quantity` — dưới mức này coi như 0. */
export const COUNT_EPSILON = 0.0005

/** Ô đếm đã khai hay chưa. Trống ≠ 0: "0" là đã đếm và hết sạch. */
export function hasCountInput(value?: string) {
  if (value === undefined || value === null) return false
  const trimmed = String(value).trim()
  return trimmed !== '' && Number.isFinite(Number(trimmed))
}

export function productsToCount<T extends { id: string }>(options: {
  products: T[]
  /** Tồn đầu ca ghi trong sổ ca. */
  openingBalances: Record<string, number>
  /** Tồn hệ thống hiện tại, GIỮ NGUYÊN DẤU (âm vẫn phải đếm). */
  expectedBalances: Record<string, number>
  movements: Array<{ productId: string; createdAt: string }>
  shiftStartedAt: string
}): T[] {
  const { products, openingBalances, expectedBalances, movements, shiftStartedAt } = options
  const ids = new Set<string>()
  products.forEach((product) => {
    if (Math.abs(openingBalances[product.id] || 0) > COUNT_EPSILON) ids.add(product.id)
    if (Math.abs(expectedBalances[product.id] || 0) > COUNT_EPSILON) ids.add(product.id)
  })
  // Mọi loại phiếu phát sinh trong ca đều là dấu hiệu SKU đang được dùng — bản cũ
  // chỉ nhận `processing_in` nên hàng chỉ bán ra (POS trừ kho) không bao giờ lọt vào.
  movements
    .filter((item) => item.createdAt >= shiftStartedAt)
    .forEach((item) => ids.add(item.productId))
  const scoped = products.filter((product) => ids.has(product.id))
  // Ca chưa phát sinh gì: vẫn phải đếm vài mặt hàng chính để ca sau có mốc.
  return scoped.length ? scoped : products.slice(0, 4)
}

/** Những mặt hàng đang hiện trên màn nhưng chưa được khai số đếm. */
export function uncountedProducts<T extends { id: string }>(
  products: T[],
  closingBalances: Record<string, string>,
) {
  return products.filter((product) => !hasCountInput(closingBalances[product.id]))
}
