import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/PayrollPage.tsx', import.meta.url), 'utf8')
const detail = page.slice(page.indexOf('{selected && <div className="payslip-modal-backdrop"'), page.indexOf('\nfunction buildPayslipRow'))
const save = page.slice(page.indexOf('async function saveDetail()'), page.indexOf('\n  async function removeDetail'))

assert.doesNotMatch(detail, /readOnly=/, 'Phiếu lương Admin vẫn còn trường nhập bị khóa.')
assert.match(detail, /Từ hệ thống · Admin có thể sửa/, 'Trường có dữ liệu hệ thống phải báo rõ Admin được sửa.')
assert.match(detail, /Từ chấm công · Admin có thể sửa/, 'Giờ làm thêm phải báo rõ Admin được sửa.')
assert.match(save, /overtimeHours: value\('overtimeHours'\)/, 'Giờ làm thêm Admin nhập phải được lưu.')
assert.match(save, /kpiBonus: value\('kpiBonus'\)/, 'Thưởng KPI Admin nhập phải được lưu.')

console.log('ADMIN_PAYSLIP_EDITABLE_OK')
