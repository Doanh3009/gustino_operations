import { PRODUCTS } from './constants'
import { branchName } from './branches'
import {
  DEFAULT_REVENUE_TARGET,
  soldBagQuantity,
  summarizeEmployeeBagSales,
} from './commission'
import type { AppUser, BagAllocation, StockMovement } from '../types'

interface LegacyBatch {
  id: number
  raw: number
  cook: number
  sku: string
  category: string
  lossRate: number
  sourceDocumentId: string
  auto: true
}

export function buildOperationalReportPatch(
  user: AppUser,
  movements: StockMovement[],
  businessDate: string,
) {
  const todayItems = movements.filter((item) => item.shiftDate === businessDate)
  const processItems = todayItems.filter((item) =>
    item.type === 'processing_out' || item.type === 'processing_in',
  )
  const grouped = new Map<string, StockMovement[]>()
  processItems.forEach((item) => {
    const key = item.documentId || item.id
    grouped.set(key, [...(grouped.get(key) || []), item])
  })

  const batches: LegacyBatch[] = Array.from(grouped.entries()).map(([documentId, rows], index) => {
    const inputs = rows.filter((item) => item.type === 'processing_out')
    const outputs = rows.filter((item) => item.type === 'processing_in')
    const primary = inputs[0]
    const output = outputs[0]
    const raw = inputs.reduce((sum, item) => sum + item.quantity, 0)
    const cook = outputs.reduce((sum, item) => sum + item.quantity, 0)
    const outputMap: Record<string, { sku: string; category: string; loss: number }> = {
      'chestnut-snow-finished': { sku: 'tp_tuyet', category: 'snow', loss: 0.04 },
      'chestnut-grilled-finished': { sku: 'tp_nuong', category: 'grilled', loss: 0.04 },
      'chestnut-cooked-kg': { sku: 'tp_rang', category: 'chestnut', loss: primary?.productId === 'chestnut-fresh' ? 0.2 : 0.04 },
      'potato-cooked-kg': { sku: 'tp_khoai', category: 'potato', loss: 0.23 },
      'cake-ready': { sku: 'tp_banh', category: 'cake', loss: 0 },
    }
    const mapped = outputMap[output?.productId] || { sku: 'tp_rang', category: 'chestnut', loss: 0.04 }
    return {
      id: index + 1,
      raw: round(raw),
      cook: round(cook),
      sku: mapped.sku,
      category: mapped.category,
      lossRate: mapped.loss,
      sourceDocumentId: documentId,
      auto: true,
    }
  })

  const wasteNotes = todayItems
    .filter((item) => item.type === 'waste')
    .map((item) => {
      const product = PRODUCTS.find((candidate) => candidate.id === item.productId)
      return `${product?.name || item.productId}: ${round(item.quantity)} ${product?.unit || ''} — ${item.note}`
    })
    .join('\n')

  const branch = { name: branchName(user.branchId) || user.branchId }
  const [year, month, day] = businessDate.split('-')
  const packed = (productId: string) => todayItems
    .filter((item) => item.type === 'packing_in' && item.productId === productId)
    .reduce((sum, item) => sum + item.quantity, 0)
  const packedMany = (productIds: string[]) => productIds.reduce(
    (sum, productId) => sum + packed(productId),
    0,
  )

  return {
    branchSelect: branch?.name || '',
    branchCustom: '',
    shiftLeader: user.name,
    shiftTime: `Ngày ${day}/${month}/${year}`,
    batches,
    calcInputs: {
      s: String(packedMany(['chestnut-110', 'snow-110', 'grilled-110']) || ''),
      m: String(packedMany(['chestnut-330', 'snow-330', 'grilled-330']) || ''),
      l: String(packedMany(['chestnut-500', 'snow-500', 'grilled-500']) || ''),
      c1k: String(packedMany(['chestnut-1kg', 'snow-1kg', 'grilled-1kg']) || ''),
      p500: String(packed('potato-500') || ''),
      p1k: String(packed('potato-1kg') || ''),
    },
    wasteNotes,
    autoSync: {
      businessDate,
      syncedAt: new Date().toISOString(),
      processingBatches: batches.length,
      inboundDocuments: new Set(todayItems.filter((item) => item.type === 'inbound').map((item) => item.documentId || item.id)).size,
    },
  }
}

const REPORT_PRODUCT_MAP: Record<string, { sku: string; size: string }> = {
  'chestnut-110': { sku: 'chestnut', size: 'S' },
  'snow-110': { sku: 'chestnut', size: 'S' },
  'grilled-110': { sku: 'chestnut', size: 'S' },
  'chestnut-330': { sku: 'chestnut', size: 'M' },
  'snow-330': { sku: 'chestnut', size: 'M' },
  'grilled-330': { sku: 'chestnut', size: 'M' },
  'chestnut-500': { sku: 'chestnut', size: 'L' },
  'snow-500': { sku: 'chestnut', size: 'L' },
  'grilled-500': { sku: 'chestnut', size: 'L' },
  'chestnut-1kg': { sku: 'chestnut', size: '1KG' },
  'snow-1kg': { sku: 'chestnut', size: '1KG' },
  'grilled-1kg': { sku: 'chestnut', size: '1KG' },
  'potato-500': { sku: 'potato', size: '500G' },
  'potato-1kg': { sku: 'potato', size: '1KG' },
  'cake-box': { sku: 'cake', size: 'BOX' },
}

export function mergeBagSalesIntoReportState(
  current: Record<string, any>,
  allocations: BagAllocation[],
) {
  const reportable = allocations.filter((item) => REPORT_PRODUCT_MAP[item.productId])
  const existingPgs = Array.isArray(current.pgs) ? current.pgs : []
  const manualPgs = existingPgs.filter((pg: Record<string, unknown>) => pg.autoSource !== 'bag-ledger')
  const previousAutoPgs = existingPgs.filter((pg: Record<string, unknown>) => pg.autoSource === 'bag-ledger')
  const employeeRows = new Map<string, BagAllocation[]>()
  reportable.forEach((allocation) => {
    const key = allocation.employeeId || normalizeKey(allocation.employeeName)
    employeeRows.set(key, [...(employeeRows.get(key) || []), allocation])
  })

  const autoPgs = Array.from(employeeRows.entries()).map(([employeeKey, rows]) => {
    const previous = previousAutoPgs.find((pg: Record<string, unknown>) => pg.employeeKey === employeeKey)
    const issuedTimes = rows.map((item) => new Date(item.issuedAt))
    const settledTimes = rows.filter((item) => item.settledAt).map((item) => new Date(item.settledAt!))
    const first = new Date(Math.min(...issuedTimes.map((date) => date.getTime())))
    const last = settledTimes.length
      ? new Date(Math.max(...settledTimes.map((date) => date.getTime())))
      : new Date(Math.max(...issuedTimes.map((date) => date.getTime())))
    return {
      id: previous?.id || `bag_${normalizeKey(employeeKey)}`,
      name: rows[0].employeeName,
      type: previous?.type || 'PT',
      in: previous?.in || reportTime(first),
      out: previous?.out || reportTime(last),
      employeeKey,
      employeeId: rows[0].employeeId || '',
      autoSource: 'bag-ledger',
    }
  })
  const pgIdByEmployee = new Map(autoPgs.map((pg) => [pg.employeeKey, pg.id]))

  const manualLogs = (Array.isArray(current.logs) ? current.logs : [])
    .filter((log: Record<string, unknown>) =>
      log.autoSource !== 'bag-ledger' && !String(log.id || '').startsWith('baglog_'),
    )
  const autoLogs = reportable.map((allocation) => {
    const mapped = REPORT_PRODUCT_MAP[allocation.productId]
    const employeeKey = allocation.employeeId || normalizeKey(allocation.employeeName)
    return {
      id: `baglog_${normalizeKey(allocation.id)}`,
      time: reportTime(new Date(allocation.issuedAt)),
      sku: mapped.sku,
      size: mapped.size,
      qty: String(allocation.issuedQuantity),
      pg: pgIdByEmployee.get(employeeKey),
      autoSource: 'bag-ledger',
      sourceAllocationId: allocation.id,
    }
  })

  const autoPgIds = new Set(autoPgs.map((pg) => pg.id))
  const matrixInputs = Object.fromEntries(
    Object.entries(current.matrixInputs || {}).filter(([key]) =>
      !Array.from(autoPgIds).some((pgId) => key.includes(`_${pgId}_out`)),
    ),
  )
  const soldByCell = new Map<string, number>()
  reportable.forEach((allocation) => {
    const mapped = REPORT_PRODUCT_MAP[allocation.productId]
    const employeeKey = allocation.employeeId || normalizeKey(allocation.employeeName)
    const pgId = pgIdByEmployee.get(employeeKey)
    if (!pgId) return
    const key = `${mapped.sku}_${mapped.size}_${pgId}_out`
    soldByCell.set(key, (soldByCell.get(key) || 0) + soldBagQuantity(allocation))
  })
  soldByCell.forEach((quantity, key) => { matrixInputs[key] = String(quantity) })

  return {
    ...current,
    pgs: [...manualPgs, ...autoPgs],
    logs: [...manualLogs, ...autoLogs],
    matrixInputs,
    bagCommissionSummary: {
      minimumRevenue: DEFAULT_REVENUE_TARGET,
      employees: summarizeEmployeeBagSales(reportable),
      reconciledAt: new Date().toISOString(),
    },
  }
}

function normalizeKey(value: string) {
  return String(value).trim().toLocaleLowerCase('vi').normalize('NFD')
    .replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9_]/g, '_')
}

function reportTime(date: Date) {
  const hours = String(Math.min(22, Math.max(7, date.getHours()))).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const value = `${hours}:${minutes}`
  if (value < '07:30') return '07:30'
  if (value > '22:00') return '22:00'
  return value
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
