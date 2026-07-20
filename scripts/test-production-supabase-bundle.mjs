import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

const fileEnv = await readEnv('.env.local')
const env = {
  ...fileEnv,
  ...(process.env.VITE_SUPABASE_URL ? { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL } : {}),
  ...(process.env.VITE_SUPABASE_ANON_KEY ? { VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY } : {}),
}
const expectedUrl = env.VITE_SUPABASE_URL
const expectedAnonKey = env.VITE_SUPABASE_ANON_KEY
assert.ok(expectedUrl, 'VITE_SUPABASE_URL must exist in .env.local for the production bundle check')
assert.ok(expectedAnonKey, 'VITE_SUPABASE_ANON_KEY must exist in .env.local for the production bundle check')

const assetsDir = join('dist', 'assets')
const files = (await readdir(assetsDir)).filter((name) => name.endsWith('.js'))
const bundles = await Promise.all(files.map(async (name) => ({
  name,
  source: await readFile(join(assetsDir, name), 'utf8'),
})))

const expectedHost = new URL(expectedUrl).host
const urlBundle = bundles.find((item) => item.source.includes(expectedUrl) || item.source.includes(expectedHost))
const keyBundle = bundles.find((item) => item.source.includes(expectedAnonKey))
const revenueBundle = bundles.find((item) => /^revenue-[\w-]+\.js$/.test(item.name))
assert.ok(
  urlBundle,
  'production JS does not contain the configured Supabase project URL; users would fall back to the LAN API and see empty data',
)
assert.ok(
  keyBundle,
  'production JS does not contain the public Supabase anon key; browser authentication/data reads cannot work',
)
assert.ok(revenueBundle, 'production build is missing the shared revenue bundle')
assert.ok(
  revenueBundle.source.includes('hasRevenueSummary') && revenueBundle.source.includes('receipt-'),
  'production revenue bundle lost the partial-snapshot POS fallback; deploying it would hide valid receipt revenue',
)

console.log(`PRODUCTION_SUPABASE_BUNDLE_OK (${basename(urlBundle.name)}; ${revenueBundle.name})`)

async function readEnv(path) {
  const result = {}
  const source = await readFile(path, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const name = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[name] = value
  }
  return result
}
