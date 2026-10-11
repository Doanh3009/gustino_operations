import assert from 'node:assert/strict'
import { ImageResponse } from '@vercel/og'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createElement } from 'react'

const run = promisify(execFile)
const baseUrl = process.env.LEADERBOARD_TEST_URL || 'http://127.0.0.1:5189/api/n8n/leaderboard-poster'
const apiKey = process.env.LEADERBOARD_TEST_API_KEY
const gustinoToken = process.env.LEADERBOARD_TEST_GUSTINO_TOKEN
assert.ok(apiKey && gustinoToken, 'Thiếu token giả dành riêng cho kiểm thử local.')
const outputDir = await mkdtemp(join(tmpdir(), 'gustino-leaderboard-'))
const names = ['LOTTE VŨNG TÀU', 'LOTTE GOLD COAST NT', 'LOTTE 23/10', 'PASSIO PHỔ QUANG', 'PASSIO ĐỒNG ĐEN', '15H']

function payload(count) {
  const chiNhanh = names.slice(0, count).map((chi_nhanh, index) => ({
    chi_nhanh,
    doanh_thu: index === 0 ? 9_999_999_999 : (count - index) * 1_250_000,
    giao_dich: (count - index) * 7,
    so_voi_hom_qua: index % 2 === 0 ? 100 : -55.6,
    so_voi_tuan_truoc: index % 2 === 0 ? -12.5 : 24.8,
  }))
  return {
    gio_cap_nhat: '12:25',
    ngay_cap_nhat: '11/10/2026',
    tong_doanh_thu: chiNhanh.reduce((sum, item) => sum + item.doanh_thu, 0),
    tong_giao_dich: chiNhanh.reduce((sum, item) => sum + item.giao_dich, 0),
    chi_nhanh: chiNhanh,
  }
}

async function curlJson({ body, header, output, url = baseUrl }) {
  const bodyFile = join(outputDir, `body-${Math.random().toString(16).slice(2)}.json`)
  await writeFile(bodyFile, JSON.stringify(body), 'utf8')
  const args = ['--silent', '--show-error', '--output', output, '--write-out', '%{http_code}', '--request', 'POST', '--header', 'Content-Type: application/json']
  if (header) args.push('--header', header)
  args.push('--data-binary', `@${bodyFile}`, url)
  const result = await run('curl.exe', args)
  return result.stdout
}

async function assertPng(path) {
  const png = await readFile(path)
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), 1080)
  assert.equal(png.readUInt32BE(20), 1920)
}

for (const count of [1, 4, 6]) {
  const output = join(outputDir, `leaderboard-${count}.png`)
  const header = count === 4 ? `x-api-key: ${apiKey}` : `x-gustino-token: ${gustinoToken}`
  assert.equal(await curlJson({ body: payload(count), header, output }), '200')
  await assertPng(output)
}

const errorOutput = join(outputDir, 'error.json')
assert.equal(await curlJson({ body: payload(1), output: errorOutput }), '401')
assert.equal(await curlJson({ body: payload(1), header: 'x-api-key: wrong', output: errorOutput }), '401')
assert.equal(await curlJson({ body: { ...payload(1), gio_cap_nhat: undefined }, header: `x-api-key: ${apiKey}`, output: errorOutput }), '400')
assert.equal(await curlJson({ body: { ...payload(1), chi_nhanh: [] }, header: `x-api-key: ${apiKey}`, output: errorOutput }), '400')

if (process.env.LEADERBOARD_EMPTY_ENV_URL) {
  assert.equal(await curlJson({ body: payload(1), header: `x-api-key: ${apiKey}`, output: errorOutput, url: process.env.LEADERBOARD_EMPTY_ENV_URL }), '401')
}

const [regularFont, boldFont] = await Promise.all([
  readFile(new URL('../api/assets/fonts/BeVietnamPro-Regular.ttf', import.meta.url)),
  readFile(new URL('../api/assets/fonts/BeVietnamPro-Bold.ttf', import.meta.url)),
])
const glyphImage = new ImageResponse(
  createElement('div', {
    style: { display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', color: '#075f3d', fontFamily: 'Be Vietnam Pro', fontSize: 72, fontWeight: 700 },
  }, 'Ơ Ư Ế Ộ Ổ Ẫ'),
  { width: 800, height: 240, fonts: [
    { name: 'Be Vietnam Pro', data: regularFont, weight: 400, style: 'normal' },
    { name: 'Be Vietnam Pro', data: boldFont, weight: 700, style: 'normal' },
  ] },
)
await writeFile(join(outputDir, 'font-glyphs.png'), Buffer.from(await glyphImage.arrayBuffer()))

console.log(`LEADERBOARD_POSTER_OK ${outputDir}`)
