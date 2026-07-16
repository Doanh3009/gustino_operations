# Quy tắc làm việc với repo Gustino

## BẮT BUỘC trước khi sửa code
1. **Đọc `CODEMAP.md` TRƯỚC khi viết/sửa bất kỳ dòng code nào.** File này là bản đồ kỹ thuật + nghiệp vụ (stack, routing hash tự viết, lib layer, mô hình kho event-sourcing, phân quyền, luồng vận hành ngày/ca, backlog). Không đoán cấu trúc từ trí nhớ.
2. Nghi ngờ tính năng "có trong repo nhưng không chạy" → kiểm tra schema/RPC/bucket trên DB thật bằng `npx supabase db query --linked "..."` trước khi debug code (nhiều migration trong repo chưa từng được apply).

## BẮT BUỘC sau khi sửa code
1. **Cập nhật `CODEMAP.md`** theo quy tắc ghi ở đầu file đó: thêm mục đánh số mới (ngày + nội dung) khi đổi cấu trúc/nghiệp vụ/luồng dữ liệu; sửa các mục cũ nếu thông tin không còn đúng.
2. Chạy `npx tsc -b` và `npm run build` phải pass trước khi coi là xong.
3. Migration mới: lưu file vào `supabase/migrations/` VÀ apply lên DB thật bằng `npx supabase db query --linked --file <file>` (db push không dùng được do lịch sử migration lệch).

## Quy ước khác
- UI mobile-first, tuyệt đối tránh cuộn ngang; không popup cho chức năng chính (xem mục 10 CODEMAP).
- Deploy production: `npm run build` rồi `npx vercel deploy --prod --yes` → https://gustino-operations.vercel.app
- **Realtime Supabase:** channel chỉ-nghe `postgres_changes` PHẢI đặt tên qua `uniqueChannelName()` (`src/lib/supabase.ts`) — supabase-js ≥2.10x tái sử dụng channel trùng topic và `.on()` sau subscribe sẽ THROW làm crash cả app. Channel presence (vd `schedule:company`) giữ topic chung giữa các client + cơ chế retry (xem mục 23 CODEMAP).
- **Dữ liệu nghiệp vụ lưu DÀI HẠN theo `business_date` trên Supabase** — không xóa/gộp theo ngày; màn hình chỉ LỌC theo ngày/tháng/năm. Trang vận hành lấy "ca hiện hành" phải lọc `businessDate === hôm nay`, không lấy mọi session `status='open'` (bug đã vá ở ShiftHandoverPage, mục 23 CODEMAP).
- **QA trước deploy:** chạy `node scripts/qa-roles.mjs`, `qa-app-navigation.mjs`, `qa-admin.mjs`, `qa-attendance.mjs`, `qa-handover.mjs`, `qa-shared-schedule-accounts.mjs` (cần `QA_ACCOUNT_API=http://127.0.0.1:5177/api/attendance`), `qa-mobile-shift-setup.mjs` với dev server đang chạy (`QA_BASE_URL=http://127.0.0.1:5173`). User QA giả LUÔN phải có `authToken` trong `gustino_user_v1` (không có sẽ bị app sign-out vì profile không tồn tại trên DB thật) và phải ghi localStorage bằng `addInitScript` (ghi sau khi app boot sẽ bị dọn mất).

## Nhật ký sửa đổi lớn gần nhất (2026-07-10)
Chi tiết ở CODEMAP mục 35. Tóm tắt 6 việc (feedback vận hành thật): (1) **Xóa đặt hàng** — thêm nút Hủy/Xóa vào OrdersPage (trước KHÔNG có nút, `deleteSupplyRequest` là dead code; RLS DELETE prod vốn cho phép → "máy khác không xóa được" = thiếu nút, không phải RLS); (2) **Xóa mẻ rang** — verify RLS/trigger/id/realtime đều OK (xóa được thật), làm `deleteMovementGroup` robust: bỏ chặn cứng khi sinh âm + tách lỗi xóa ↔ lỗi refresh; (3) **Bếp tiếng Việt** — sửa mojibake CP1252 + literal không dấu trong `KitchenPage.tsx` (i18n.ts vốn sạch); (4) **Bánh hạt dẻ thành phẩm** — activate `cake-ready` (BC-BANH) + rebind `cake-box.recipe` từ trừ NVL sang trừ thành phẩm (`source`) + broaden picker "thành phẩm nguồn" gồm đầu-ra-chế-biến non-kg; (5) **Nút Hôm nay dashboard** — sửa `rollingRange` off-by-one (`Math.max(1→0, days-1)`) + mặc định vào là HÔM NAY (đảo §25); (6) **Chấm công bù 04-10/07** — Phase A từ đăng ký ca approved 06-10 (không đè check-in thật), Phase B từ ảnh lịch tuần 1 cho 04-05 (tên khớp DB, 39 record). `tsc -b`+`build` pass; qa-roles/app-navigation/admin pass; đã deploy production.

### Nhật ký trước (2026-07-04)
Chi tiết ở CODEMAP mục 29. Tóm tắt 5 việc CÒN LẠI của §28: (1) KHO ca trưởng gom về đúng **4 chức năng** Tồn kho / Nhập hàng / Xuất bán / Kiểm kê (Nhập có sub-toggle Nguyên liệu ↔ Chế biến); (2) thêm **card hao hụt–tồn kho theo chi nhánh** ở trang quản lý (dùng chung bộ lọc chi nhánh + ngày/tất cả có sẵn); (3) **sổ kho + kho báo cáo infographic thu gọn theo ngày**, bấm ngày mới xổ (`<details>`, tránh 100 card); (4) UX đăng ký ca mượt hơn (nút chuyển tuần ‹ Tuần trước / Tuần này / Tuần sau ›, sửa copy); (5) rà **công thức KPI** — `commission.ts POSITION_KPI_FORMULAS` KHỚP CHÍNH XÁC bảng user gửi, không cần đổi. `tsc -b` + `npm run build` pass; 9 script QA pass (sửa 3 script stale do §27/§28); đã deploy production.

### Nhật ký trước (2026-07-03)
Chi tiết ở CODEMAP mục 23. Tóm tắt: (1) vá crash trắng trang manager/admin do supabase-js 2.108 trùng topic realtime; (2) vá ca mở ngày cũ rò sang hôm nay ở màn Phát túi/Bàn giao; (3) hiện lại tab "Bảng lịch" cho manager/admin; (4) đại tu 7 script QA — tất cả pass; (5) build pass + đã deploy production.
