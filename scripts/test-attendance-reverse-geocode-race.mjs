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

  // Địa chỉ tới số nhà là mức duy nhất được cache lâu: cache một ngày cho bản thô
  // sẽ khiến mọi lần chấm công sau tại đúng toạ độ đó cũng chỉ còn tên thành phố.
  fetchCount = 0
  globalThis.fetch = async (input) => {
    fetchCount += 1
    const url = String(input)
    if (url.includes('nominatim')) {
      await delay(5)
      return {
        ok: true,
        json: async () => ({
          display_name: 'Phường 8, Vũng Tàu',
          address: { suburb: 'Phường 8', city: 'Vũng Tàu' },
        }),
      }
    }
    await delay(5)
    return {
      ok: true,
      json: async () => ({ locality: 'Vũng Tàu', principalSubdivision: 'Bà Rịa - Vũng Tàu', countryName: 'Việt Nam' }),
    }
  }
  const areaOnly = responseRecorder()
  await handler({ query: { lat: '10.346', lng: '107.084' } }, areaOnly)
  assert.equal(areaOnly.statusCode, 200)
  assert.equal(areaOnly.payload.precision, 'area', 'Thiếu số nhà/tên đường phải bị đánh dấu là địa chỉ mức khu vực.')
  assert.equal(areaOnly.headers['Cache-Control'], 's-maxage=60', 'Địa chỉ thô không được cache một ngày.')

  // Toà nhà/cửa hàng (Lotte Mart, Gold Coast…) là mốc dễ đối chiếu quầy nhất.
  fetchCount = 0
  globalThis.fetch = async (input) => {
    fetchCount += 1
    if (String(input).includes('nominatim')) {
      await delay(5)
      return {
        ok: true,
        json: async () => ({
          display_name: 'Lotte Mart, 6 Đường 3 Tháng 2, Phường 8, Vũng Tàu',
          address: { building: 'Lotte Mart', house_number: '6', road: 'Đường 3 Tháng 2', suburb: 'Phường 8', city: 'Vũng Tàu' },
        }),
      }
    }
    await delay(5)
    return { ok: true, json: async () => ({ locality: 'Vũng Tàu', countryName: 'Việt Nam' }) }
  }
  const building = responseRecorder()
  await handler({ query: { lat: '10.346', lng: '107.084' } }, building)
  assert.equal(building.payload.precision, 'street')
  assert.match(building.payload.address, /^Lotte Mart, 6 Đường 3 Tháng 2/)
  assert.equal(building.headers['Cache-Control'], 's-maxage=86400, stale-while-revalidate=604800')

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
