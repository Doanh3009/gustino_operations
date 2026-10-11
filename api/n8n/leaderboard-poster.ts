import { ImageResponse } from '@vercel/og'
import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createElement, type ReactNode } from 'react'

const WIDTH = 1080
const HEIGHT = 1920
const ALLOWED_BRANCHES = new Set([
  '15H',
  'LOTTE GOLD COAST NT',
  'LOTTE 23/10',
  'LOTTE VŨNG TÀU',
  'PASSIO PHỔ QUANG',
  'PASSIO ĐỒNG ĐEN',
])

type BranchInput = {
  chi_nhanh: string
  doanh_thu: number
  giao_dich: number
  so_voi_hom_qua: number
  so_voi_tuan_truoc: number
}

type PosterInput = {
  gio_cap_nhat: string
  ngay_cap_nhat: string
  tong_doanh_thu: number
  tong_giao_dich: number
  chi_nhanh: BranchInput[]
}

let fontPromise: Promise<{ regular: Buffer; bold: Buffer }> | undefined

function loadFonts() {
  fontPromise ||= Promise.all([
    readFile(new URL('../assets/fonts/BeVietnamPro-Regular.ttf', import.meta.url)),
    readFile(new URL('../assets/fonts/BeVietnamPro-Bold.ttf', import.meta.url)),
  ]).then(([regular, bold]) => ({ regular, bold }))
  return fontPromise
}

function safeTokenEqual(provided: unknown, expected: string | undefined): boolean {
  const value = Array.isArray(provided) ? provided[0] : provided
  if (typeof value !== 'string' || !value || !expected) return false
  const actual = Buffer.from(value)
  const target = Buffer.from(expected)
  return actual.length === target.length && timingSafeEqual(actual, target)
}

function isAuthorized(headers: Record<string, unknown>): boolean {
  return safeTokenEqual(headers['x-gustino-token'], process.env.N8N_REPORT_WEBHOOK_TOKEN)
    || safeTokenEqual(headers['x-api-key'], process.env.N8N_API_SECRET)
}

function finiteNumber(value: unknown, path: string, options: { integer?: boolean; min?: number } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} phải là số hữu hạn.`
  if (options.integer && !Number.isInteger(value)) return `${path} phải là số nguyên.`
  if (options.min !== undefined && value < options.min) return `${path} phải lớn hơn hoặc bằng ${options.min}.`
  return null
}

function validateInput(value: unknown): { error?: string; data?: PosterInput } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Body phải là một JSON object.' }
  const input = value as Record<string, unknown>
  if (typeof input.gio_cap_nhat !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.gio_cap_nhat)) {
    return { error: 'gio_cap_nhat phải là chuỗi giờ HH:mm hợp lệ.' }
  }
  if (typeof input.ngay_cap_nhat !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(input.ngay_cap_nhat)) {
    return { error: 'ngay_cap_nhat phải là chuỗi ngày dd/mm/yyyy.' }
  }
  const totalRevenueError = finiteNumber(input.tong_doanh_thu, 'tong_doanh_thu', { min: 0 })
  if (totalRevenueError) return { error: totalRevenueError }
  const totalOrdersError = finiteNumber(input.tong_giao_dich, 'tong_giao_dich', { integer: true, min: 0 })
  if (totalOrdersError) return { error: totalOrdersError }
  if (!Array.isArray(input.chi_nhanh) || input.chi_nhanh.length === 0) {
    return { error: 'chi_nhanh phải là mảng có từ 1 đến 6 phần tử.' }
  }
  if (input.chi_nhanh.length > 6) return { error: 'chi_nhanh không được có quá 6 phần tử.' }

  const seen = new Set<string>()
  for (let index = 0; index < input.chi_nhanh.length; index += 1) {
    const item = input.chi_nhanh[index]
    const path = `chi_nhanh[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: `${path} phải là object.` }
    const branch = item as Record<string, unknown>
    if (typeof branch.chi_nhanh !== 'string' || !ALLOWED_BRANCHES.has(branch.chi_nhanh)) {
      return { error: `${path}.chi_nhanh không thuộc danh sách chi nhánh hợp lệ.` }
    }
    if (seen.has(branch.chi_nhanh)) return { error: `${path}.chi_nhanh bị trùng.` }
    seen.add(branch.chi_nhanh)
    const fields: Array<[string, unknown, { integer?: boolean; min?: number }]> = [
      ['doanh_thu', branch.doanh_thu, { min: 0 }],
      ['giao_dich', branch.giao_dich, { integer: true, min: 0 }],
      ['so_voi_hom_qua', branch.so_voi_hom_qua, {}],
      ['so_voi_tuan_truoc', branch.so_voi_tuan_truoc, {}],
    ]
    for (const [name, fieldValue, options] of fields) {
      const error = finiteNumber(fieldValue, `${path}.${name}`, options)
      if (error) return { error }
    }
    if (Number(branch.doanh_thu) === 0 && Number(branch.giao_dich) === 0) {
      return { error: `${path} phải có doanh_thu > 0 hoặc giao_dich > 0.` }
    }
  }

  return { data: input as unknown as PosterInput }
}

function h(type: string, style: Record<string, unknown>, ...children: ReactNode[]) {
  return createElement(type, { style }, ...children)
}

function formatVnd(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')} VND`
}

function revenueFontSize(value: number, baseSize: number) {
  const length = formatVnd(value).length
  if (length >= 17) return Math.min(baseSize, 47)
  if (length >= 15) return Math.min(baseSize, 53)
  return baseSize
}

function formatPercent(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
}

function percentBlock(label: string, value: number, valueSize: number, labelSize: number) {
  const color = value > 0 ? '#18a957' : value < 0 ? '#dc2626' : '#7a7a7a'
  return h('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
    h('div', { display: 'flex', alignItems: 'center', color, fontSize: valueSize, fontWeight: 700, lineHeight: 1 },
      formatPercent(value),
    ),
    h('div', { display: 'flex', color: '#68736e', fontSize: labelSize, marginTop: 8 }, label),
  )
}

function medal(rank: number, size: number) {
  const colors = rank === 1
    ? ['#fff3a6', '#e7b10c', '#9b6500']
    : rank === 2
      ? ['#ffffff', '#b7bec8', '#69717c']
      : rank === 3
        ? ['#ffd2a3', '#c9752a', '#7d3f13']
        : ['#dfffe9', '#39b96b', '#136b39']
  return h('div', {
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: size, height: size, borderRadius: 999, color: '#ffffff',
    fontSize: Math.round(size * 0.44), fontWeight: 700,
    border: `${Math.max(4, Math.round(size * 0.06))}px solid ${colors[2]}`,
    backgroundImage: `linear-gradient(145deg, ${colors[0]}, ${colors[1]})`,
    boxShadow: `0 5px 14px rgba(0,0,0,0.28)`,
  }, String(rank))
}

function orderBadge(orders: number, size: number, numberSize: number, labelSize: number) {
  return h('div', {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    width: size, height: size, borderRadius: 999, flexShrink: 0,
    backgroundColor: '#ffffff', border: `${Math.max(4, Math.round(size * 0.055))}px solid #f4c515`,
    boxShadow: '0 5px 14px rgba(0,0,0,0.25)',
  },
  h('div', { display: 'flex', color: '#e10600', fontSize: numberSize, fontWeight: 700, lineHeight: 1 }, String(orders)),
  h('div', { display: 'flex', color: '#304139', fontSize: labelSize, fontWeight: 700, marginTop: 5 }, 'Giao dịch'))
}

function totalsBar(input: PosterInput, density: ReturnType<typeof dimensions>) {
  return h('div', {
    display: 'flex', alignItems: 'center', width: '100%', height: density.totalBar, flexShrink: 0,
    marginBottom: density.gap, padding: `0 ${density.cardPad}px`, borderRadius: density.radius,
    border: `${density.border}px solid #f4c515`, backgroundColor: '#fffef7',
    boxShadow: '0 0 18px rgba(244,197,21,0.4)',
  },
  h('div', { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
    h('div', { display: 'flex', color: '#68736e', fontSize: density.totalLabel, fontWeight: 700 }, 'TỔNG DOANH THU'),
    h('div', { display: 'flex', color: '#075f3d', fontSize: revenueFontSize(input.tong_doanh_thu, density.totalValue), fontWeight: 700, lineHeight: 1.05, marginTop: 5, whiteSpace: 'nowrap' }, formatVnd(input.tong_doanh_thu)),
  ),
  h('div', { display: 'flex', width: 2, height: '62%', flexShrink: 0, margin: `0 ${density.cardPad}px`, backgroundColor: '#e6d48a' }),
  h('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: density.badge * 1.45 },
    h('div', { display: 'flex', color: '#68736e', fontSize: density.totalLabel, fontWeight: 700 }, 'TỔNG GIAO DỊCH'),
    h('div', { display: 'flex', color: '#e10600', fontSize: density.totalValue, fontWeight: 700, lineHeight: 1.05, marginTop: 5 }, String(input.tong_giao_dich)),
  ))
}

function branchCard(branch: BranchInput, rank: number, density: ReturnType<typeof dimensions>) {
  return h('div', {
    display: 'flex', alignItems: 'center', width: '100%', flex: 1, minHeight: 0,
    borderRadius: density.radius, border: `${density.border}px solid #8ef02d`,
    backgroundColor: '#ffffff', padding: `0 ${density.cardPad}px`,
    boxShadow: '0 0 16px rgba(142,240,45,0.42)',
  },
  medal(rank, density.medal),
  h('div', { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, marginLeft: density.cardPad },
    h('div', { display: 'flex', color: '#075f3d', fontSize: density.name, fontWeight: 700, lineHeight: 1.05, whiteSpace: 'nowrap' }, branch.chi_nhanh),
    h('div', { display: 'flex', color: '#e10600', fontSize: revenueFontSize(branch.doanh_thu, density.revenue), fontWeight: 700, lineHeight: 1, marginTop: density.smallGap, whiteSpace: 'nowrap' }, formatVnd(branch.doanh_thu)),
    h('div', { display: 'flex', alignItems: 'stretch', marginTop: density.smallGap },
      percentBlock('So với hôm qua', branch.so_voi_hom_qua, density.percent, density.label),
      h('div', { display: 'flex', width: 2, backgroundColor: '#dfe5e1', margin: `0 ${density.smallGap}px` }),
      percentBlock('So với tuần trước', branch.so_voi_tuan_truoc, density.percent, density.label),
    ),
  ),
  orderBadge(branch.giao_dich, density.badge, density.badgeNumber, density.badgeLabel))
}

function dimensions(branchCount: number) {
  if (branchCount >= 6) return { header: 280, totalBar: 118, totalLabel: 20, totalValue: 38, gap: 12, radius: 22, border: 5, cardPad: 20, medal: 88, badge: 92, name: 31, revenue: 41, percent: 25, label: 17, badgeNumber: 30, badgeLabel: 15, smallGap: 9 }
  if (branchCount === 5) return { header: 295, totalBar: 126, totalLabel: 21, totalValue: 41, gap: 14, radius: 24, border: 5, cardPad: 23, medal: 96, badge: 99, name: 35, revenue: 45, percent: 28, label: 18, badgeNumber: 32, badgeLabel: 16, smallGap: 10 }
  if (branchCount >= 3) return { header: 315, totalBar: 140, totalLabel: 23, totalValue: 46, gap: 16, radius: 27, border: 6, cardPad: 27, medal: 108, badge: 110, name: 39, revenue: 51, percent: 31, label: 20, badgeNumber: 36, badgeLabel: 18, smallGap: 12 }
  return { header: 340, totalBar: 156, totalLabel: 26, totalValue: 52, gap: 20, radius: 32, border: 7, cardPad: 34, medal: 126, badge: 126, name: 46, revenue: 58, percent: 35, label: 23, badgeNumber: 41, badgeLabel: 20, smallGap: 15 }
}

function poster(input: PosterInput) {
  const branches = [...input.chi_nhanh].sort((a, b) => b.doanh_thu - a.doanh_thu)
  const density = dimensions(branches.length)
  return h('div', {
    display: 'flex', flexDirection: 'column', width: WIDTH, height: HEIGHT, padding: '42px 46px 46px',
    color: '#ffffff', fontFamily: 'Be Vietnam Pro',
    backgroundImage: 'linear-gradient(180deg, #07583f 0%, #063a2c 52%, #042b21 100%)',
    border: '12px solid #83f12d', borderRadius: 38,
    boxShadow: 'inset 0 0 40px rgba(131,241,45,0.32)',
  },
  h('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: density.header, flexShrink: 0 },
    h('div', { display: 'flex', alignItems: 'center', color: '#f6d65c', fontSize: branches.length >= 5 ? 43 : 49, fontWeight: 700 }, 'Hạt Dẻ Ông Lý'),
    h('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#ffffff', fontSize: branches.length >= 5 ? 50 : 58, fontWeight: 700, lineHeight: 1.05, marginTop: 14 },
      h('div', { display: 'flex' }, 'BẢNG THI ĐUA DOANH SỐ'),
      h('div', { display: 'flex' }, 'CÁC CHI NHÁNH'),
    ),
    h('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 18, padding: '10px 32px', borderRadius: 999, color: '#ffffff', fontSize: branches.length >= 5 ? 25 : 29, fontWeight: 700, border: '3px solid #f2c94c', backgroundColor: '#074b35' },
      `Cập nhật lúc ${input.gio_cap_nhat} • ${input.ngay_cap_nhat}`,
    ),
  ),
  h('div', { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
    totalsBar(input, density),
    ...branches.flatMap((branch, index) => [
      branchCard(branch, index + 1, density),
      index < branches.length - 1 ? h('div', { display: 'flex', height: density.gap, flexShrink: 0 }) : null,
    ]).filter(Boolean) as ReactNode[],
  ),
  h('div', { display: 'flex', position: 'absolute', opacity: 0, fontSize: 1, left: 0, bottom: 0 }, 'Ơ Ư Ế Ộ Ổ Ẫ'))
}

export default async function handler(request: any, response: any) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Chỉ hỗ trợ POST.' })
  }
  if (!isAuthorized(request.headers || {})) return response.status(401).json({ error: 'Unauthorized' })

  let rawInput: unknown
  try {
    rawInput = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  } catch {
    return response.status(400).json({ error: 'Body không phải JSON hợp lệ.' })
  }
  const validated = validateInput(rawInput)
  if (!validated.data) return response.status(400).json({ error: validated.error })

  try {
    const fonts = await loadFonts()
    const image = new ImageResponse(poster(validated.data), {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'Be Vietnam Pro', data: fonts.regular, weight: 400, style: 'normal' },
        { name: 'Be Vietnam Pro', data: fonts.bold, weight: 700, style: 'normal' },
      ],
    })
    const png = Buffer.from(await image.arrayBuffer())
    response.setHeader('Content-Type', 'image/png')
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).send(png)
  } catch (error) {
    console.error('[leaderboard-poster] render failed:', error instanceof Error ? error.message : 'Unknown error')
    return response.status(500).json({ error: 'Không dựng được poster.' })
  }
}
