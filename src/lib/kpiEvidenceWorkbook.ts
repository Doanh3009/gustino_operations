export interface KpiEvidenceSummaryRow {
  employeeKey: string
  employeeName: string
  branchId: string
  branchName: string
  roleLabel: string
  shiftCount: number
  revenue: number
  targetRevenue: number
  progress: number
  rank: string
  reward: number
}

export interface KpiEvidenceSourceRow {
  businessDate: string
  employeeKey: string
  employeeName: string
  branchId: string
  branchName: string
  roleLabel: string
  sourceType: string
  sourceId: string
  sourceCode: string
  shiftLabel: string
  detail: string
  meta: string
  quantity: number
  revenue: number
  createdAt: string
}

export interface KpiEvidenceWorkbookInput {
  filters: Array<{ label: string; value: string }>
  summaryRows: KpiEvidenceSummaryRow[]
  sourceRows: KpiEvidenceSourceRow[]
  title: string
  generatedAt: Date
}

export async function buildKpiEvidenceWorkbook(input: KpiEvidenceWorkbookInput) {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Gustino Operations'
  workbook.created = input.generatedAt
  workbook.modified = input.generatedAt
  Object.assign(workbook, {
    subject: 'KPI doanh thu kèm bằng chứng nguồn',
    description: 'Bảng tổng hợp KPI có công thức đối chiếu về từng hóa đơn và phiếu giao túi nguồn.',
  })

  const filterSheet = workbook.addWorksheet('Bộ lọc & giải thích', { views: [{ showGridLines: false }] })
  filterSheet.columns = [
    { header: 'Thông tin', key: 'label', width: 28 },
    { header: 'Giá trị', key: 'value', width: 62 },
  ]
  input.filters.forEach((item) => filterSheet.addRow(item))
  filterSheet.addRow({ label: 'Cách đối chiếu', value: 'Tổng bằng chứng = tổng cột Doanh thu ở sheet Bằng chứng doanh thu theo đúng mã nhân sự và chi nhánh.' })
  filterSheet.addRow({ label: 'Nguồn giao túi', value: 'Số đã bán từ phiếu giao túi đã chốt, định giá theo cấu hình sản phẩm hiện hành của hệ thống.' })
  filterSheet.addRow({ label: 'Nguồn hóa đơn', value: 'Chỉ các dòng bán trực tiếp chưa gắn allocationId; dòng đã gắn phiếu giao túi bị loại để không cộng doanh thu hai lần.' })
  filterSheet.addRow({ label: 'Nguồn ca trưởng', value: 'Toàn bộ hóa đơn nằm trong chi nhánh, ngày và khung giờ của ca do ca trưởng phụ trách.' })
  applySheetTitle(filterSheet, input.title)

  const evidenceSheet = workbook.addWorksheet('Bằng chứng doanh thu', { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }] })
  evidenceSheet.columns = [
    { header: 'Ngày', key: 'businessDate', width: 13 },
    { header: 'Mã nhân sự', key: 'employeeKey', width: 22 },
    { header: 'Nhân sự', key: 'employeeName', width: 26 },
    { header: 'Mã chi nhánh', key: 'branchId', width: 18 },
    { header: 'Chi nhánh', key: 'branchName', width: 24 },
    { header: 'Vai trò', key: 'roleLabel', width: 17 },
    { header: 'Loại nguồn', key: 'sourceType', width: 15 },
    { header: 'Mã nguồn', key: 'sourceId', width: 24 },
    { header: 'Mã hóa đơn', key: 'sourceCode', width: 18 },
    { header: 'Ca', key: 'shiftLabel', width: 12 },
    { header: 'Sản phẩm / diễn giải', key: 'detail', width: 42 },
    { header: 'Người bán / thanh toán', key: 'meta', width: 34 },
    { header: 'Số lượng', key: 'quantity', width: 13 },
    { header: 'Doanh thu', key: 'revenue', width: 17 },
    { header: 'Thời điểm ghi nhận', key: 'createdAt', width: 22 },
  ]
  input.sourceRows.forEach((row) => evidenceSheet.addRow({
    ...row,
    businessDate: new Date(`${row.businessDate}T00:00:00`),
    createdAt: new Date(row.createdAt),
  }))
  applySheetTitle(evidenceSheet, 'BẰNG CHỨNG NGUỒN DOANH THU')
  evidenceSheet.getColumn('businessDate').numFmt = 'dd/mm/yyyy'
  evidenceSheet.getColumn('createdAt').numFmt = 'dd/mm/yyyy hh:mm'
  evidenceSheet.getColumn('quantity').numFmt = '#,##0.00'
  evidenceSheet.getColumn('revenue').numFmt = '#,##0" đ"'
  evidenceSheet.getColumn('detail').alignment = { vertical: 'top', wrapText: true }
  evidenceSheet.getColumn('meta').alignment = { vertical: 'top', wrapText: true }

  const summarySheet = workbook.addWorksheet('Tổng hợp KPI', { views: [{ state: 'frozen', ySplit: 2, showGridLines: false }] })
  summarySheet.columns = [
    { header: 'Hạng', key: 'position', width: 9 },
    { header: 'Mã nhân sự', key: 'employeeKey', width: 22 },
    { header: 'Nhân sự', key: 'employeeName', width: 26 },
    { header: 'Mã chi nhánh', key: 'branchId', width: 18 },
    { header: 'Chi nhánh', key: 'branchName', width: 24 },
    { header: 'Vai trò', key: 'roleLabel', width: 17 },
    { header: 'Số ca', key: 'shiftCount', width: 10 },
    { header: 'Doanh thu bảng', key: 'revenue', width: 18 },
    { header: 'Mục tiêu KPI', key: 'targetRevenue', width: 18 },
    { header: 'Tỷ lệ đạt', key: 'progress', width: 14 },
    { header: 'Xếp loại', key: 'rank', width: 11 },
    { header: 'Thưởng KPI', key: 'reward', width: 16 },
    { header: 'Số nguồn', key: 'sourceCount', width: 12 },
    { header: 'Tổng bằng chứng', key: 'evidenceRevenue', width: 19 },
    { header: 'Chênh lệch', key: 'difference', width: 16 },
    { header: 'Đối chiếu', key: 'reconciliation', width: 14 },
  ]
  const evidenceTotals = new Map<string, { count: number; revenue: number }>()
  input.sourceRows.forEach((source) => {
    const key = `${source.branchId}|${source.employeeKey}`
    const current = evidenceTotals.get(key) || { count: 0, revenue: 0 }
    current.count += 1
    current.revenue += source.revenue
    evidenceTotals.set(key, current)
  })
  input.summaryRows.forEach((row, index) => {
    const evidence = evidenceTotals.get(`${row.branchId}|${row.employeeKey}`) || { count: 0, revenue: 0 }
    summarySheet.addRow({
      position: index + 1,
      ...row,
      progress: row.progress / 100,
      sourceCount: evidence.count,
      evidenceRevenue: evidence.revenue,
      difference: row.revenue - evidence.revenue,
      reconciliation: Math.abs(row.revenue - evidence.revenue) <= 1 ? 'Khớp' : 'Lệch',
    })
  })
  applySheetTitle(summarySheet, 'TỔNG HỢP KPI VÀ ĐỐI CHIẾU BẰNG CHỨNG')
  const evidenceEndRow = Math.max(3, input.sourceRows.length + 2)
  input.summaryRows.forEach((row, index) => {
    const sheetRow = index + 3
    const evidence = evidenceTotals.get(`${row.branchId}|${row.employeeKey}`) || { count: 0, revenue: 0 }
    summarySheet.getCell(`M${sheetRow}`).value = {
      formula: `COUNTIFS('Bằng chứng doanh thu'!$B$3:$B$${evidenceEndRow},B${sheetRow},'Bằng chứng doanh thu'!$D$3:$D$${evidenceEndRow},D${sheetRow})`,
      result: evidence.count,
      date1904: false,
    }
    summarySheet.getCell(`N${sheetRow}`).value = {
      formula: `SUMIFS('Bằng chứng doanh thu'!$N$3:$N$${evidenceEndRow},'Bằng chứng doanh thu'!$B$3:$B$${evidenceEndRow},B${sheetRow},'Bằng chứng doanh thu'!$D$3:$D$${evidenceEndRow},D${sheetRow})`,
      result: evidence.revenue,
      date1904: false,
    }
    summarySheet.getCell(`O${sheetRow}`).value = { formula: `H${sheetRow}-N${sheetRow}`, result: row.revenue - evidence.revenue, date1904: false }
    summarySheet.getCell(`P${sheetRow}`).value = {
      formula: `IF(ABS(O${sheetRow})<=1,"Khớp","Lệch")`,
      result: Math.abs(row.revenue - evidence.revenue) <= 1 ? 'Khớp' : 'Lệch',
      date1904: false,
    }
    if (Math.abs(row.revenue - evidence.revenue) > 1) {
      for (const column of ['O', 'P']) {
        summarySheet.getCell(`${column}${sheetRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE7C2' } }
        summarySheet.getCell(`${column}${sheetRow}`).font = { bold: true, color: { argb: 'FF8A4B08' } }
      }
    }
  })
  for (const key of ['revenue', 'targetRevenue', 'reward', 'evidenceRevenue', 'difference']) summarySheet.getColumn(key).numFmt = '#,##0" đ"'
  summarySheet.getColumn('progress').numFmt = '0.0%'
  summarySheet.getColumn('shiftCount').numFmt = '#,##0'

  return workbook
}

function applySheetTitle(sheet: import('exceljs').Worksheet, title: string) {
  sheet.spliceRows(1, 0, [title])
  sheet.mergeCells(1, 1, 1, sheet.columnCount)
  const titleCell = sheet.getCell('A1')
  titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102238' } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getRow(1).height = 28
  sheet.getRow(2).height = 24
  sheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF789D12' } }
  sheet.getRow(2).alignment = { vertical: 'middle', wrapText: true }
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sheet.columnCount } }
}
