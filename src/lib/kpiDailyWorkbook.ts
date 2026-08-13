import { importChunk } from './lazyRoute'

export interface DailyKpiExportRow {
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

export interface DailyKpiWorkbookInput {
  from: string
  to: string
  branchLabel: string
  employeeLabel: string
  generatedAt: Date
  rows: DailyKpiExportRow[]
}

/** Workbook chi tiết dùng đúng dữ liệu KPI ngày đã tính cho bảng lương. */
export async function buildDailyKpiWorkbook(input: DailyKpiWorkbookInput) {
  const ExcelJS = await importChunk(() => import('exceljs'))
  const Workbook = ExcelJS.Workbook || (ExcelJS as unknown as { default: typeof ExcelJS }).default.Workbook
  const workbook = new Workbook()
  workbook.creator = 'Gustino Operations'
  workbook.created = input.generatedAt
  workbook.modified = input.generatedAt
  Object.assign(workbook, {
    subject: 'KPI và thưởng theo ngày',
    description: 'Chi tiết ngày, nhân viên, doanh thu, mục tiêu KPI và thưởng ngày theo công thức hiện hành.',
  })

  const sheet = workbook.addWorksheet('KPI thưởng theo ngày', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    properties: { defaultRowHeight: 20 },
  })
  sheet.columns = [
    { key: 'date', width: 14 },
    { key: 'employeeKey', width: 22 },
    { key: 'employeeName', width: 26 },
    { key: 'branchId', width: 18 },
    { key: 'branchName', width: 24 },
    { key: 'positionTitle', width: 18 },
    { key: 'totalHours', width: 14 },
    { key: 'revenue', width: 18 },
    { key: 'targetRevenue', width: 18 },
    { key: 'progress', width: 13 },
    { key: 'rank', width: 11 },
    { key: 'dailyBonus', width: 17 },
  ]

  sheet.mergeCells('A1:L1')
  sheet.getCell('A1').value = `KPI & THƯỞNG THEO NGÀY · ${formatDateKey(input.from)} - ${formatDateKey(input.to)}`
  sheet.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102238' } }
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getRow(1).height = 30

  const totalRevenue = input.rows.reduce((sum, row) => sum + row.revenue, 0)
  const totalBonus = input.rows.reduce((sum, row) => sum + row.dailyBonus, 0)
  sheet.getCell('A2').value = 'Kỳ dữ liệu'
  sheet.getCell('B2').value = `${formatDateKey(input.from)} - ${formatDateKey(input.to)}`
  sheet.getCell('D2').value = 'Chi nhánh'
  sheet.getCell('E2').value = input.branchLabel
  sheet.getCell('F2').value = 'Tổng doanh thu'
  sheet.getCell('G2').value = totalRevenue
  sheet.getCell('J2').value = 'Tổng thưởng ngày'
  sheet.getCell('K2').value = totalBonus
  sheet.getCell('A3').value = 'Nhân viên'
  sheet.getCell('B3').value = input.employeeLabel
  sheet.getCell('D3').value = 'Xuất lúc'
  sheet.getCell('E3').value = input.generatedAt
  sheet.getCell('F3').value = 'Số dòng có KPI'
  sheet.getCell('G3').value = input.rows.length
  sheet.getCell('J3').value = 'Số dòng có thưởng'
  sheet.getCell('K3').value = input.rows.filter((row) => row.dailyBonus > 0).length

  for (const cell of ['A2', 'D2', 'F2', 'J2', 'A3', 'D3', 'F3', 'J3']) {
    sheet.getCell(cell).font = { bold: true, color: { argb: 'FF334155' } }
  }
  for (const cell of ['G2', 'K2']) {
    sheet.getCell(cell).font = { bold: true, size: 12, color: { argb: 'FF102238' } }
    sheet.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2D4' } }
  }
  sheet.getCell('G2').numFmt = '#,##0" đ"'
  sheet.getCell('K2').numFmt = '#,##0" đ"'
  sheet.getCell('E3').numFmt = 'dd/mm/yyyy hh:mm'

  sheet.getRow(4).values = [
    'Ngày', 'Mã nhân viên', 'Nhân viên', 'Mã chi nhánh', 'Chi nhánh', 'Vị trí',
    'Giờ công', 'Doanh thu ngày', 'KPI ngày', '% đạt', 'Hạng', 'Thưởng ngày',
  ]
  sheet.getRow(4).height = 26
  sheet.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF789D12' } }
  sheet.getRow(4).alignment = { vertical: 'middle', wrapText: true }

  input.rows.forEach((row) => {
    sheet.addRow({
      ...row,
      date: excelDate(row.date),
      progress: row.progress / 100,
    })
  })

  sheet.getColumn('date').numFmt = 'dd/mm/yyyy'
  sheet.getColumn('totalHours').numFmt = '0.00'
  sheet.getColumn('revenue').numFmt = '#,##0" đ"'
  sheet.getColumn('targetRevenue').numFmt = '#,##0" đ"'
  sheet.getColumn('progress').numFmt = '0.0%'
  sheet.getColumn('dailyBonus').numFmt = '#,##0" đ"'
  for (const key of ['totalHours', 'revenue', 'targetRevenue', 'progress', 'dailyBonus']) {
    sheet.getColumn(key).alignment = { horizontal: 'right', vertical: 'middle' }
  }
  sheet.getColumn('date').alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getColumn('rank').alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.autoFilter = { from: 'A4', to: `L${Math.max(4, input.rows.length + 4)}` }

  input.rows.forEach((row, index) => {
    if (row.dailyBonus <= 0) return
    const excelRow = index + 5
    sheet.getCell(`L${excelRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2D4' } }
    sheet.getCell(`L${excelRow}`).font = { bold: true, color: { argb: 'FF3F6212' } }
  })

  return workbook
}

function excelDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-')
  return `${day}/${month}/${year}`
}
