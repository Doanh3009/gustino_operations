/**
 * SEPARATED_SHIFT_ROLES — Ca trưởng và Ca phó là hai vai trò khác nhau.
 *
 * Chính sách ĐÃ ĐỔI ngày 10/08/2026 theo quyết định trực tiếp của chủ hệ thống:
 * Ca phó **truy cập ngang Ca trưởng** (Hôm nay, Kho, Bàn giao, Đặt hàng, Báo cáo).
 * Bản trước cố tình giới hạn Ca phó ở mức nhân viên (chỉ bán hàng/chấm công/lịch);
 * hệ quả là ghi hồ sơ xuống DB thành `staff` và RLS chặn sạch các bảng vận hành —
 * đúng lỗi "đã set quyền Ca phó rồi mà vẫn không vào được".
 *
 * CẬP NHẬT 13/08/2026 — ranh giới cuối cùng cũng bị gỡ theo yêu cầu chủ hệ thống:
 * Ca phó **được đứng tên phiên ca** như Ca trưởng. Luật cũ "ca phó không đứng tên
 * ca" khiến 12/08 Nguyễn Thị Yến có lịch + đã chấm công mà không nhận nổi Ca 2.
 *
 * Hai vai trò vẫn TÁCH BẠCH ở chỗ khác và test này khoá đúng chỗ đó:
 *   · role ứng dụng vẫn có `shift_deputy` riêng;
 *   · vẫn LƯU xuống DB là `shift_leader` (lưu `staff` là bị RLS chặn sạch);
 *   · KPI/lương vẫn chấm theo chức danh Ca phó, mức riêng.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [types, access, attendance, admin, control, app, login, autoOpen, assignment] = await Promise.all([
  readFile(new URL('../src/types.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/access.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ControlCenterPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/shiftAutoOpen.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/operationalShiftAssignment.ts', import.meta.url), 'utf8'),
])

// --- Hai vai trò vẫn phải tách bạch ---------------------------------------
assert.ok(types.includes("'shift_leader' | 'shift_deputy'"), 'Role ứng dụng chưa tách Ca trưởng/Ca phó.')
assert.ok(
  access.includes("role === 'shift_deputy' || /(^|[^a-z])ca pho"),
  'Hồ sơ có chức danh Ca phó chưa được chuẩn hóa thành role riêng.',
)
assert.ok(login.includes('profile?.position_title || metadata.position_title'), 'Đăng nhập chưa phân biệt role bằng chức danh.')

// --- Quyền truy cập: Ca phó ngang Ca trưởng (chính sách mới) ---------------
assert.ok(
  access.includes("OPERATION_ROLES: Role[] = ['shift_leader', 'shift_deputy']"),
  'Ca phó phải vào được các màn vận hành như Ca trưởng.',
)
assert.ok(
  access.includes("['shift_leader', 'shift_deputy', 'staff', 'cashier']"),
  'Ca phó phải còn quyền bán hàng trực tiếp.',
)
assert.ok(
  attendance.includes("role === 'shift_deputy' ? 'shift_leader' : role"),
  'Ca phó phải được LƯU xuống DB là shift_leader; lưu thành staff là bị RLS chặn hết bảng vận hành.',
)
assert.ok(
  !app.includes("user.role === 'staff' || user.role === 'shift_deputy' || user.role === 'cashier'"),
  'Ca phó không còn mặc định rơi về màn Bán hàng.',
)

// --- 13/08/2026: Ca phó ĐỨNG TÊN phiên ca như Ca trưởng --------------------
assert.ok(
  !autoOpen.includes('blockedAsDeputy'),
  'Lớp chặn Ca phó đứng tên phiên ca phải bị gỡ — chính nó gây lỗi 12/08 của Nguyễn Thị Yến.',
)
assert.ok(
  autoOpen.includes("!['shift_leader', 'shift_deputy'].includes(user.role)"),
  'Cua nhan ca thu cong phai cho Ca pho bam nhan ca nhu Ca truong.',
)
assert.ok(
  !autoOpen.includes('reclaimShiftForPrimaryLeader'),
  'Không còn cơ chế tự giật quyền chủ ca: ai bấm nhận ca thì ca mang tên người đó.',
)
// Phải soi CODE, không soi comment: đoạn giải thích lịch sử có nhắc lại nguyên
// văn dòng cũ, nên `includes` trần sẽ báo nhầm.
assert.ok(
  !/^\s*if \(isDeputyShiftLeader\(registration\)\) return false/m.test(assignment),
  'Xếp phiên ca không được loại Ca phó ra khỏi danh sách khung giờ.',
)
// Vẫn giữ hàm nhận diện chức danh — nó còn phục vụ việc chấm KPI theo mức Ca phó.
assert.ok(assignment.includes('export function isDeputyShiftLeader'), 'Mất lớp nhận diện chức danh Ca phó cho KPI.')

// --- KPI và quản trị vẫn nhận diện Ca phó riêng ----------------------------
assert.ok(admin.includes("PAYROLL_ROLES: Role[] = ['shift_leader', 'shift_deputy', 'staff']"), 'Bảng KPI đang bỏ sót Ca phó.')
assert.ok(admin.includes("{ value: 'shift_deputy', label: 'Ca phó' }"), 'Admin chưa có lựa chọn Ca phó riêng.')
assert.ok(control.includes("shift_deputy: 'Ca phó'"), 'Ma trận quyền chưa hiển thị Ca phó riêng.')

console.log('SEPARATED_SHIFT_ROLES_20260810_OK')
