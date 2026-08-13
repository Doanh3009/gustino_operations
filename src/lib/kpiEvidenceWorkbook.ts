import { importChunk } from './lazyRoute'

export interface KpiEvidenceSummaryRow {
  employeeKey: string
  employeeName: string
  branchId: string
  branchName: string
  roleLabel: string
  shiftCount: number
  soldQuantity: number
  revenue: number
  targetRevenue: number
  progress: number
  rank: string
  reward: number
}

export interface KpiEvidenceDailyRow {
  date: string
  employeeKey: string
  employeeName: string
  branchId: string
  branchName: string
  positionTitle: string
  totalHours: number
  soldQuantity: number
  revenue: number
  targetRevenue: number
  progress: number
  rank: string
  dailyBonus: number
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
  dailyRows: KpiEvidenceDailyRow[]
  sourceRows: KpiEvidenceSourceRow[]
  title: string
  generatedAt: Date
}

/**
 * File đối chiếu dành cho người vận hành: số liệu chính luôn ở cột nhìn thấy;
 * mã kỹ thuật chỉ nằm trong hai cột ẩn cuối sheet để công thức vẫn đối chiếu
 * chính xác khi hai nhân viên trùng tên.
 */
export async function buildKpiEvidenceWorkbook(input: KpiEvidenceWorkbookInput) {
  const ExcelJS = await importChunk(() => import('exceljs'))
  const Workbook = ExcelJS.Workbook || (ExcelJS as unknown as { default: typeof ExcelJS }).default.Workbook
  const workbook = new Workbook()
  workbook.creator = 'Gustino Operations'
  workbook.created = input.generatedAt
  workbook.modified = input.generatedAt
  Object.assign(workbook, {
    subject: 'Thi đua nhân viên và bằng chứng doanh thu',
    description: 'Tổng hợp tháng, chi tiết theo ngày từng nhân viên và nguồn doanh thu đối chiếu.',
  })

  const periodLabel = filterValue(input.filters, 'Kỳ dữ liệu') || input.title
  const classificationLabel = filterValue(input.filters, 'Phân loại') || 'Thi đua nhân viên'
  const branchLabel = filterValue(input.filters, 'Chi nhánh') || 'Toàn hệ thống'
  const employeeLabel = filterValue(input.filters, 'Nhân sự toàn cục') || 'Tất cả nhân viên'

  const evidenceTotals = new Map<string, { count: number; revenue: number }>()
  input.sourceRows.forEach((source) => {
    const key = employeeBranchKey(source.employeeKey, source.branchId)
    const current = evidenceTotals.get(key) || { count: 0, revenue: 0 }
    current.count += 1
    current.revenue += source.revenue
    evidenceTotals.set(key, current)
  })

  const monthlySheet = workbook.addWorksheet('Tổng hợp tháng', {
    views: [{ state: 'frozen', ySplit: 5, showGridLines: false }],
    properties: { defaultRowHeight: 20 },
  })
  monthlySheet.columns = [
    { key: 'position', width: 8 },
    { key: 'employeeName', width: 25 },
    { key: 'branchName', width: 23 },
    { key: 'roleLabel', width: 18 },
    { key: 'shiftCount', width: 10 },
    { key: 'soldQuantity', width: 12 },
    { key: 'revenue', width: 18 },
    { key: 'targetRevenue', width: 18 },
    { key: 'progress', width: 12 },
    { key: 'rank', width: 11 },
    { key: 'reward', width: 16 },
    { key: 'sourceCount', width: 11 },
    { key: 'evidenceRevenue', width: 18 },
    { key: 'difference', width: 16 },
    { key: 'reconciliation', width: 13 },
    { key: 'employeeKey', width: 2, hidden: true },
    { key: 'branchId', width: 2, hidden: true },
  ]
  applyTitle(monthlySheet, input.title, 17)
  setSummaryPair(monthlySheet, 'A2', 'B2', 'Kỳ dữ liệu', periodLabel)
  setSummaryPair(monthlySheet, 'D2', 'E2', 'Phân loại', classificationLabel)
  setSummaryPair(monthlySheet, 'G2', 'H2', 'Tổng doanh thu', input.summaryRows.reduce((sum, row) => sum + row.revenue, 0), true)
  setSummaryPair(monthlySheet, 'J2', 'K2', 'Tổng thưởng KPI', input.summaryRows.reduce((sum, row) => sum + row.reward, 0), true)
  setSummaryPair(monthlySheet, 'A3', 'B3', 'Chi nhánh', branchLabel)
  setSummaryPair(monthlySheet, 'D3', 'E3', 'Nhân viên', employeeLabel)
  setSummaryPair(monthlySheet, 'G3', 'H3', 'Số nhân viên', input.summaryRows.length)
  setSummaryPair(monthlySheet, 'J3', 'K3', 'Xuất lúc', input.generatedAt)
  monthlySheet.getCell('K3').numFmt = 'dd/mm/yyyy hh:mm'
  setHeader(monthlySheet, 5, [
    'Hạng', 'Nhân viên', 'Chi nhánh', 'Vai trò', 'Số ca', 'Sản lượng',
    'Doanh thu tháng', 'KPI tháng', '% đạt', 'Xếp loại', 'Thưởng KPI',
    'Số nguồn', 'Doanh thu đối chiếu', 'Chênh lệch', 'Kết quả', '', '',
  ])

  input.summaryRows.forEach((row, index) => {
    const evidence = evidenceTotals.get(employeeBranchKey(row.employeeKey, row.branchId)) || { count: 0, revenue: 0 }
    const sheetRow = monthlySheet.addRow({
      position: index + 1,
      ...row,
      progress: row.progress / 100,
      sourceCount: evidence.count,
      evidenceRevenue: evidence.revenue,
      difference: row.revenue - evidence.revenue,
      reconciliation: Math.abs(row.revenue - evidence.revenue) <= 1 ? 'Khớp' : 'Lệch',
    })
    const rowNumber = sheetRow.number
    const evidenceEndRow = Math.max(4, input.sourceRows.length + 3)
    sheetRow.getCell(12).value = {
      formula: `COUNTIFS('Chi tiết doanh thu'!$J$4:$J$${evidenceEndRow},P${rowNumber},'Chi tiết doanh thu'!$K$4:$K$${evidenceEndRow},Q${rowNumber})`,
      result: evidence.count,
      date1904: false,
    }
    sheetRow.getCell(13).value = {
      formula: `SUMIFS('Chi tiết doanh thu'!$I$4:$I$${evidenceEndRow},'Chi tiết doanh thu'!$J$4:$J$${evidenceEndRow},P${rowNumber},'Chi tiết doanh thu'!$K$4:$K$${evidenceEndRow},Q${rowNumber})`,
      result: evidence.revenue,
      date1904: false,
    }
    sheetRow.getCell(14).value = { formula: `G${rowNumber}-M${rowNumber}`, result: row.revenue - evidence.revenue, date1904: false }
    sheetRow.getCell(15).value = {
      formula: `IF(ABS(N${rowNumber})<=1,"Khớp","Lệch")`,
      result: Math.abs(row.revenue - evidence.revenue) <= 1 ? 'Khớp' : 'Lệch',
      date1904: false,
    }
    styleDataRow(sheetRow, 15)
    if (row.reward > 0) applyPositiveCell(sheetRow.getCell(11))
    if (Math.abs(row.revenue - evidence.revenue) > 1) {
      applyWarningCell(sheetRow.getCell(14))
      applyWarningCell(sheetRow.getCell(15))
    }
  })
  monthlySheet.getColumn('soldQuantity').numFmt = '#,##0.##'
  monthlySheet.getColumn('revenue').numFmt = '#,##0" đ"'
  monthlySheet.getColumn('targetRevenue').numFmt = '#,##0" đ"'
  monthlySheet.getColumn('progress').numFmt = '0.0%'
  monthlySheet.getColumn('reward').numFmt = '#,##0" đ"'
  monthlySheet.getColumn('evidenceRevenue').numFmt = '#,##0" đ"'
  monthlySheet.getColumn('difference').numFmt = '#,##0" đ"'
  monthlySheet.autoFilter = { from: 'A5', to: `O${Math.max(5, input.summaryRows.length + 5)}` }

  const dailyGroups = buildDailyGroups(input.dailyRows, input.sourceRows)
  const dailySheet = workbook.addWorksheet('Theo ngày nhân viên', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    properties: { defaultRowHeight: 20 },
  })
  dailySheet.columns = [
    { key: 'date', width: 14 },
    { key: 'employeeName', width: 25 },
    { key: 'branchName', width: 23 },
    { key: 'positionTitle', width: 18 },
    { key: 'totalHours', width: 12 },
    { key: 'soldQuantity', width: 12 },
    { key: 'sourceCount', width: 11 },
    { key: 'revenue', width: 18 },
    { key: 'targetRevenue', width: 17 },
    { key: 'progress', width: 12 },
    { key: 'rank', width: 10 },
    { key: 'dailyBonus', width: 16 },
    { key: 'employeeKey', width: 2, hidden: true },
    { key: 'branchId', width: 2, hidden: true },
  ]
  applyTitle(dailySheet, 'THI ĐUA THEO NGÀY · TỪNG NHÂN VIÊN', 14)
  setSummaryPair(dailySheet, 'A2', 'B2', 'Tổng doanh thu', dailyGroups.reduce((sum, row) => sum + row.revenue, 0), true)
  setSummaryPair(dailySheet, 'D2', 'E2', 'Tổng thưởng ngày', dailyGroups.reduce((sum, row) => sum + row.dailyBonus, 0), true)
  setSummaryPair(dailySheet, 'G2', 'H2', 'Số nhân viên-ngày', dailyGroups.length)
  setSummaryPair(dailySheet, 'J2', 'K2', 'Kỳ dữ liệu', periodLabel)
  setHeader(dailySheet, 4, [
    'Ngày', 'Nhân viên', 'Chi nhánh', 'Vị trí', 'Giờ công', 'Sản lượng',
    'Số nguồn', 'Doanh thu ngày', 'KPI ngày', '% đạt', 'Hạng', 'Thưởng ngày', '', '',
  ])
  dailyGroups.forEach((row) => {
    const sheetRow = dailySheet.addRow({ ...row, date: excelDate(row.date), progress: row.progress / 100 })
    styleDataRow(sheetRow, 12)
    if (row.dailyBonus > 0) applyPositiveCell(sheetRow.getCell(12))
  })
  dailySheet.getColumn('date').numFmt = 'dd/mm/yyyy'
  dailySheet.getColumn('totalHours').numFmt = '0.00'
  dailySheet.getColumn('soldQuantity').numFmt = '#,##0.##'
  dailySheet.getColumn('revenue').numFmt = '#,##0" đ"'
  dailySheet.getColumn('targetRevenue').numFmt = '#,##0" đ"'
  dailySheet.getColumn('progress').numFmt = '0.0%'
  dailySheet.getColumn('dailyBonus').numFmt = '#,##0" đ"'
  dailySheet.autoFilter = { from: 'A4', to: `L${Math.max(4, dailyGroups.length + 4)}` }

  const detailSheet = workbook.addWorksheet('Chi tiết doanh thu', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
    properties: { defaultRowHeight: 20 },
  })
  detailSheet.columns = [
    { key: 'businessDate', width: 14 },
    { key: 'createdAt', width: 17 },
    { key: 'employeeName', width: 25 },
    { key: 'branchName', width: 23 },
    { key: 'sourceType', width: 16 },
    { key: 'reference', width: 18 },
    { key: 'mainDetail', width: 42 },
    { key: 'quantity', width: 12 },
    { key: 'revenue', width: 18 },
    { key: 'employeeKey', width: 2, hidden: true },
    { key: 'branchId', width: 2, hidden: true },
  ]
  applyTitle(detailSheet, 'CHI TIẾT NGUỒN DOANH THU', 11)
  setSummaryPair(detailSheet, 'A2', 'B2', 'Số nguồn', input.sourceRows.length)
  setSummaryPair(detailSheet, 'D2', 'E2', 'Tổng doanh thu', input.sourceRows.reduce((sum, row) => sum + row.revenue, 0), true)
  setSummaryPair(detailSheet, 'G2', 'H2', 'Kỳ dữ liệu', periodLabel)
  setHeader(detailSheet, 3, [
    'Ngày', 'Giờ ghi nhận', 'Nhân viên', 'Chi nhánh', 'Nguồn', 'Bill / Ca',
    'Nội dung chính', 'Số lượng', 'Doanh thu', '', '',
  ])
  input.sourceRows
    .slice()
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.createdAt.localeCompare(a.createdAt))
    .forEach((row) => {
      const sheetRow = detailSheet.addRow({
        businessDate: excelDate(row.businessDate),
        createdAt: excelVietnamDateTime(row.createdAt),
        employeeName: row.employeeName,
        branchName: row.branchName,
        sourceType: row.sourceType,
        reference: sourceReference(row),
        mainDetail: sourceMainDetail(row),
        quantity: row.quantity,
        revenue: row.revenue,
        employeeKey: row.employeeKey,
        branchId: row.branchId,
      })
      styleDataRow(sheetRow, 9)
    })
  detailSheet.getColumn('businessDate').numFmt = 'dd/mm/yyyy'
  detailSheet.getColumn('createdAt').numFmt = 'hh:mm'
  detailSheet.getColumn('quantity').numFmt = '#,##0.##'
  detailSheet.getColumn('revenue').numFmt = '#,##0" đ"'
  detailSheet.getColumn('mainDetail').alignment = { vertical: 'top', wrapText: true }
  detailSheet.autoFilter = { from: 'A3', to: `I${Math.max(3, input.sourceRows.length + 3)}` }

  return workbook
}

function buildDailyGroups(dailyRows: KpiEvidenceDailyRow[], sourceRows: KpiEvidenceSourceRow[]) {
  const groups = new Map<string, KpiEvidenceDailyRow & { sourceCount: number }>()
  const authoritativeDailyKeys = new Set<string>()
  dailyRows.forEach((row) => {
    const key = dailyKey(row.date, row.employeeKey, row.branchId)
    authoritativeDailyKeys.add(key)
    groups.set(key, { ...row, sourceCount: 0 })
  })
  sourceRows.forEach((source) => {
    const key = dailyKey(source.businessDate, source.employeeKey, source.branchId)
    const existing = groups.get(key)
    if (existing) {
      existing.sourceCount += 1
      if (!authoritativeDailyKeys.has(key)) {
        existing.soldQuantity += source.quantity
        existing.revenue += source.revenue
      }
      return
    }
    groups.set(key, {
      date: source.businessDate,
      employeeKey: source.employeeKey,
      employeeName: source.employeeName,
      branchId: source.branchId,
      branchName: source.branchName,
      positionTitle: source.roleLabel,
      totalHours: 0,
      soldQuantity: source.quantity,
      sourceCount: 1,
      revenue: source.revenue,
      targetRevenue: 0,
      progress: 0,
      rank: '',
      dailyBonus: 0,
    })
  })
  return Array.from(groups.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
    || a.branchName.localeCompare(b.branchName, 'vi')
    || b.revenue - a.revenue
    || a.employeeName.localeCompare(b.employeeName, 'vi'),
  )
}

function applyTitle(sheet: import('exceljs').Worksheet, title: string, columnCount: number) {
  sheet.mergeCells(1, 1, 1, columnCount)
  const cell = sheet.getCell('A1')
  cell.value = title
  cell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102238' } }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getRow(1).height = 30
}

function setHeader(sheet: import('exceljs').Worksheet, rowNumber: number, values: string[]) {
  const row = sheet.getRow(rowNumber)
  row.values = values
  row.height = 28
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF789D12' } }
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
}

function setSummaryPair(
  sheet: import('exceljs').Worksheet,
  labelCell: string,
  valueCell: string,
  label: string,
  value: string | number | Date,
  currency = false,
) {
  const labelTarget = sheet.getCell(labelCell)
  const valueTarget = sheet.getCell(valueCell)
  labelTarget.value = label
  labelTarget.font = { bold: true, color: { argb: 'FF526173' } }
  valueTarget.value = value
  valueTarget.font = { bold: true, color: { argb: 'FF102238' } }
  if (currency) {
    valueTarget.numFmt = '#,##0" đ"'
    valueTarget.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2D4' } }
  }
}

function styleDataRow(row: import('exceljs').Row, visibleColumnCount: number) {
  row.height = 22
  for (let column = 1; column <= visibleColumnCount; column += 1) {
    const cell = row.getCell(column)
    cell.alignment = { vertical: 'middle', wrapText: column === 2 || column === 7 }
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
  }
}

function applyPositiveCell(cell: import('exceljs').Cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2D4' } }
  cell.font = { bold: true, color: { argb: 'FF3F6212' } }
}

function applyWarningCell(cell: import('exceljs').Cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE7C2' } }
  cell.font = { bold: true, color: { argb: 'FF8A4B08' } }
}

function filterValue(filters: KpiEvidenceWorkbookInput['filters'], label: string) {
  return filters.find((item) => item.label === label)?.value || ''
}

function employeeBranchKey(employeeKey: string, branchId: string) {
  return `${branchId}|${employeeKey}`
}

function dailyKey(date: string, employeeKey: string, branchId: string) {
  return `${date}|${branchId}|${employeeKey}`
}

function sourceReference(row: KpiEvidenceSourceRow) {
  return [row.sourceCode, row.shiftLabel].filter(Boolean).join(' · ')
    || (row.sourceType.includes('Hóa đơn') ? 'Bill POS' : 'Giao túi')
}

function sourceMainDetail(row: KpiEvidenceSourceRow) {
  const usefulMeta = /(?:mã nguồn|source id)/i.test(row.meta) ? '' : row.meta.trim()
  return [row.detail.trim(), usefulMeta].filter(Boolean).join(' · ')
}

function excelDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function excelVietnamDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return parsed
  return new Date(parsed.getTime() + 7 * 60 * 60 * 1000)
}
