# GUSTINO Operations

Web app báo cáo cuối ngày và quản lý kho cho nhiều chi nhánh.

Các nghiệp vụ chính:

- Phiếu nhập và xuất kho có nhiều sản phẩm trong cùng một chứng từ.
- Phiếu kiểm kê theo mẫu kho đông, kho phòng, số lượng cần đặt và ghi chú.
- Dashboard Nhà hàng tổng hợp tồn kho, hoạt động nhập xuất và doanh thu từ báo cáo ca.
- Báo cáo ca cần được lưu để hình thành lịch sử doanh thu và KPI của chi nhánh.
- Mỗi chi nhánh có một Ngày vận hành. Nhập kho, các mẻ đầu ca/phát sinh, xuất kho và kiểm kê đều gắn vào ngày này.
- Báo cáo cuối ngày tự lấy mẻ chế biến và số thành phẩm từ kho; ca trưởng chỉ bổ sung bán hàng, PG, sự cố và bàn giao.
- Một mẻ chế biến hỗ trợ nhiều nguyên liệu và nhiều thành phẩm, có quy đổi kg để tính hao hụt.
- Chấm công và ca làm: nhân viên tự thêm ca có hiệu lực ngay, check-in bắt buộc selfie, check-out và xuất bảng công CSV/XLSX.

## Chạy trên máy

```powershell
npm.cmd install
npm.cmd run dev
```

Mở `http://localhost:5173`.
Lệnh `npm.cmd run dev` tự khởi động cả giao diện và API dữ liệu LAN dùng cho chấm công.

Nếu chưa cấu hình Supabase, ứng dụng tự chạy chế độ demo bằng `localStorage`.

## Kết nối PostgreSQL/Supabase

1. Tạo dự án tại Supabase.
2. Mở SQL Editor và chạy `supabase/schema.sql`.
3. Tạo file `.env.local` dựa trên `.env.example`.
4. Điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY`.
5. Tạo tài khoản trong Supabase Auth và thêm dòng tương ứng vào bảng `profiles`.

Sau schema nền, chạy migration `supabase/migrations/20260618_attendance_module.sql`
để tạo ca làm, bảng công, phân công quản lý nhiều chi nhánh và bucket lưu selfie.
Sau đó chạy `supabase/migrations/20260619_attendance_without_approval.sql`
để bỏ bước duyệt lịch làm và cho ca mới có hiệu lực ngay.
Chạy tiếp `supabase/migrations/20260619_shift_bag_handover.sql`
để bật sổ túi theo nhân viên và bàn giao giữa hai ca trưởng.
Cuối cùng chạy `supabase/migrations/20260622_merge_admin_into_manager.sql`
để gộp Admin vào Quản lý, giới hạn Quản lý ở màn hình tổng hợp và chỉ cho Ca trưởng ghi dữ liệu vận hành.
Chạy tiếp `supabase/migrations/20260622_shared_schedule_accounts.sql`
để bật bảng đăng ký ca chung, định biên gợi ý và trạng thái tài khoản.
Chạy `supabase/migrations/20260622_realtime_schedule_geotag.sql`
để thêm nhóm ca theo vị trí, cập nhật lịch theo thời gian thực và lưu địa chỉ/tọa độ check-in.
Chạy `supabase/migrations/20260622_commission_rules.sql`
để gắn lượt bán với account nhân viên và cấu hình KPI/hoa hồng theo chi nhánh.
Chạy tiếp `supabase/migrations/20260623_align_report_commission.sql`
để đồng bộ mốc hoa hồng 15 túi với báo cáo cuối ca; mức tiền được tính tự động theo giá từng loại túi.

Triển khai hàm máy chủ quản lý account:

```powershell
supabase functions deploy manage-employee
```

Hàm này dùng Supabase Auth để tạo, đặt lại mật khẩu và vô hiệu hóa tài khoản. Mật khẩu gốc không được lưu trong bảng nhân sự; Quản lý chỉ nhận mật khẩu tạm một lần khi tạo hoặc đặt lại.

Khi deploy Vercel, thư mục `api/reverse-geocode.ts` cung cấp địa chỉ cho dấu ảnh chấm công. Nếu dịch vụ địa chỉ không phản hồi, hệ thống vẫn ghi tọa độ GPS và sai số lên ảnh.

## Triển khai

Build:

```powershell
npm.cmd run build
```

Thư mục đầu ra là `dist`, có thể triển khai trên Cloudflare Pages hoặc Vercel.
