import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = readEnv('.env.local')
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
let authError
for (const email of ['admin@accounts.gustino.vn', 'admin@gustino.vn']) {
  const { error } = await client.auth.signInWithPassword({ email, password: '123456' })
  authError = error
  if (!error) break
}
if (authError) throw authError

const names = ['Mã Thị Thanh Trúc', 'Đặng Thị Khánh Linh']
const { data: profiles, error: profileError } = await client.from('profiles')
  .select('id, full_name, role, employment_type, position_title')
  .eq('branch_id', 'lotte-vt')
  .in('full_name', names)
if (profileError) throw profileError

const from = '2026-07-01'
const to = '2026-07-31'
const results = []
for (const profile of profiles || []) {
  const { data: receipts, error } = await client.from('sales_receipts')
    .select('business_date, total_amount')
    .eq('branch_id', 'lotte-vt')
    .eq('seller_id', profile.id)
    .gte('business_date', from)
    .lte('business_date', to)
  if (error) throw error
  const daily = new Map()
  for (const receipt of receipts || []) {
    daily.set(receipt.business_date, (daily.get(receipt.business_date) || 0) + Number(receipt.total_amount || 0))
  }
  const days = [...daily].sort(([left], [right]) => left.localeCompare(right)).map(([date, revenue]) => {
    const target = deputyTarget(date)
    return { date, revenue, target, progress: Number((revenue / target * 100).toFixed(1)), achieved: revenue >= target }
  })
  const weeks = new Map()
  for (const day of days) {
    const key = weekStart(day.date)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key).push(day)
  }
  const dailyBonus = days.filter((day) => day.achieved).length * 30000
  const weeklyBonus = [...weeks.values()].reduce((sum, week) => {
    const achieved = week.filter((day) => day.achieved).length
    return sum + (achieved >= 6 ? 200000 : achieved >= 5 ? 100000 : 0)
  }, 0)
  const revenue = days.reduce((sum, day) => sum + day.revenue, 0)
  const target = 13692000
  const progress = revenue / target * 100
  const monthlyBonus = progress >= 120 ? 2500000
    : progress >= 110 ? 2000000
      : progress >= 100 ? 1500000
        : progress >= 90 ? 1000000
          : progress >= 80 ? 500000 : 0
  results.push({
    profile,
    receiptCount: (receipts || []).length,
    salesDayCount: days.length,
    achievedDayCount: days.filter((day) => day.achieved).length,
    revenue,
    target,
    progress: Number(progress.toFixed(1)),
    dailyBonus,
    weeklyBonus,
    monthlyBonus,
    totalBaseBonus: dailyBonus + weeklyBonus + monthlyBonus,
    days,
  })
}

console.log(JSON.stringify({ mode: 'READ_ONLY', from, to, results }, null, 2))
console.log('VUNG_TAU_JULY_DEPUTY_BONUS_READONLY_OK')

function deputyTarget(date) {
  if (date <= '2026-07-15') return 500000
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6 ? 468000 : 360000
}

function weekStart(date) {
  const value = new Date(`${date}T00:00:00Z`)
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() - day + 1)
  return value.toISOString().slice(0, 10)
}

function readEnv(path) {
  const output = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index > 0) output[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return output
}
