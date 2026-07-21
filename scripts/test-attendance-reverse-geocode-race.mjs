import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const source = await readFile(new URL('../api/reverse-geocode.ts', import.meta.url), 'utf8')
const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const { default: handler } = await import(moduleUrl)

const originalFetch = globalThis.fetch
try {
  let fetchCount = 0
  globalThis.fetch = async (input) => {
    fetchCount += 1
    const url = String(input)
    if (url.includes('nominatim')) {
      await delay(40)
      return {
        ok: true,
        json: async () => ({
          display_name: '33 Đường 3 Tháng 2, Phường 8, Vũng Tàu',
          address: { house_number: '33', road: 'Đường 3 Tháng 2', suburb: 'Phường 8', city: 'Vũng Tàu' },
        }),
      }
    }
    await delay(5)
    return {
      ok: true,
      json: async () => ({ locality: 'Vũng Tàu', principalSubdivision: 'Bà Rịa - Vũng Tàu', countryName: 'Việt Nam' }),
    }
  }

  const success = responseRecorder()
  await handler({ query: { lat: '10.346', lng: '107.084' } }, success)
  assert.equal(success.statusCode, 200)
  assert.equal(success.payload.source, 'nominatim', 'Nguồn đường/phường phải thắng nguồn thành phố nhanh hơn trong khoảng chờ ngắn.')
  assert.match(success.payload.address, /33 Đường 3 Tháng 2, Phường 8, Vũng Tàu/)
  assert.equal(fetchCount, 2, 'Hai nhà cung cấp phải được khởi chạy trong cùng lần lấy địa chỉ.')

  fetchCount = 0
  globalThis.fetch = async (input) => {
    fetchCount += 1
    const url = String(input)
    if (url.includes('nominatim')) {
      await delay(40)
      return { ok: false, json: async () => ({}) }
    }
    await delay(5)
    return {
      ok: true,
      json: async () => ({ locality: 'Vũng Tàu', principalSubdivision: 'Bà Rịa - Vũng Tàu', countryName: 'Việt Nam' }),
    }
  }
  const fallback = responseRecorder()
  await handler({ query: { lat: '10.346', lng: '107.084' } }, fallback)
  assert.equal(fallback.statusCode, 200)
  assert.equal(fallback.payload.source, 'bigdatacloud')
  assert.equal(fetchCount, 2)

  const invalid = responseRecorder()
  await handler({ query: { lat: '999', lng: '107.084' } }, invalid)
  assert.equal(invalid.statusCode, 400)
  assert.match(invalid.payload.error, /không hợp lệ/i)
} finally {
  globalThis.fetch = originalFetch
}

console.log('ATTENDANCE_REVERSE_GEOCODE_RACE_OK')

function responseRecorder() {
  return {
    statusCode: 200,
    payload: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
