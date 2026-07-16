# BẢN YÊU CẦU PHÂN TÍCH NGHIỆP VỤ

**Dự án:** Hệ thống POS & Quản lý Vận hành Nội bộ - Chuỗi "Hạt Dẻ Ông Lý"
**Mô hình vận hành:** Kiosk trong Lotte / điểm bán nhỏ nhiều ca
**Nền tảng:** Web-based App, ưu tiên Mobile-First, SPA
**Phạm vi:** Quản lý nội bộ, vận hành ca, kho, bếp, bán hàng, chấm công, lương, báo cáo, đối soát
**Không thuộc phạm vi:** CRM khách hàng, tích điểm khách hàng, chăm sóc khách hàng, marketing automation

---

## 1. Yêu Cầu Tổng Quan

### 1.1. Mục tiêu hệ thống

Hệ thống được xây dựng để số hóa toàn bộ quy trình vận hành nội bộ của chuỗi kiosk "Hạt Dẻ Ông Lý", bao gồm:

- Quản lý nhân sự, ca làm, chấm công.
- Quản lý nhập kho, chế biến, đóng gói, phân bổ hàng cho nhân viên bán hàng.
- Quản lý POS nội bộ để tạo mã hóa đơn phục vụ đối soát với quầy tổng Lotte.
- Quản lý bàn giao ca, tồn kho cuối ca, báo cáo cuối ngày.
- Quản lý yêu cầu bếp, yêu cầu đặt hàng, dự trù nguyên liệu.
- Quản lý lương, hoa hồng, thưởng/phạt.
- Quản lý báo cáo doanh thu, kho, hiệu suất nhân viên và chi nhánh.

### 1.2. Định hướng UI/UX

- Mobile-first, thao tác nhanh bằng chạm/vuốt.
- Desktop dùng sidebar, mobile dùng bottom navigation hoặc app launcher.
- Giao diện nghiệp vụ cần giống các hệ thống POS/quản lý phổ biến như CukCuk, Sapo, KiotViet.
- Ưu tiên màn hình thao tác ngắn, nút lớn, ít nhập liệu tay.
- Tối ưu cho điện thoại của ca trưởng/nhân viên và tablet tại bếp.

### 1.3. Kiến trúc dữ liệu

- Ưu tiên PostgreSQL hoặc MySQL chuẩn hóa.
- Sử dụng ORM hoặc migration rõ ràng để dễ nâng cấp, backup, migrate lên Google Cloud SQL hoặc Supabase/Postgres.
- Có Data Dictionary cho toàn bộ bảng nghiệp vụ.
- Dữ liệu phải phân quyền theo chi nhánh, vai trò và quyền thao tác.
- Mọi nghiệp vụ quan trọng cần có audit log.

### 1.4. Đa ngôn ngữ

- Hệ thống hỗ trợ chuyển đổi ngôn ngữ theo cấu hình.
- Giai đoạn đầu bắt buộc có Vietnamese.
- English là tùy chọn nhưng cấu trúc i18n phải sẵn sàng mở rộng.
- Ngôn ngữ hiển thị cần lưu theo người dùng hoặc trình duyệt.

---

## 2. Phân Quyền Và Vai Trò

### 2.1. Dynamic RBAC

Hệ thống cần hỗ trợ phân quyền động theo mô hình:

- Tạo/sửa/xóa nhóm quyền.
- Gán người dùng vào nhóm quyền.
- Tick quyền theo từng module.
- Mỗi module có tối thiểu các quyền:
  - View
  - Add
  - Edit
  - Delete
  - Export
  - Approve
  - Config

Ví dụ module cần phân quyền:

- Dashboard
- POS bán hàng
- Kho
- Bàn giao ca
- Báo cáo cuối ca
- Bếp
- Đặt hàng
- Chấm công
- Lịch làm
- Lương
- Hoa hồng
- Nhân sự
- Master Data
- Đối soát Lotte
- Audit Log

### 2.2. Super Admin

Super Admin là tài khoản cao nhất, dùng để setup hệ thống ban đầu và quản trị cấu hình nền.

Chức năng:

- Quản lý tài khoản nhân viên.
- Tạo nhóm quyền động.
- Gán quyền chi tiết theo module.
- Quản lý chi nhánh/kiosk.
- Quản lý master data sản phẩm, giá bán, định mức, ngưỡng tồn.
- Cấu hình thông tin hệ thống.
- Xem audit log toàn hệ thống.
- Khóa/mở tài khoản.
- Reset mật khẩu.

### 2.3. Quản Lý

Quản lý tập trung vào điều hành, số liệu, nhân sự, lương và kiểm soát vận hành.

Chức năng:

- Dashboard doanh thu theo chi nhánh/ngày/tuần/tháng.
- Biểu đồ so sánh doanh thu giữa chi nhánh.
- Biểu đồ tỷ trọng bán hàng theo nhân viên.
- Báo cáo mặt hàng bán chạy.
- Báo cáo hao hụt chế biến.
- Báo cáo tồn kho realtime từng chi nhánh.
- Báo cáo kiểm kê và chênh lệch.
- Duyệt/chỉnh sửa bảng công.
- Quản lý lịch làm, ca làm, đổi ca, tăng ca.
- Quản lý lương, hoa hồng, thưởng, phạt.
- Export Excel/CSV cho kế toán.
- Duyệt hoặc xử lý yêu cầu đặt hàng.
- Xem báo cáo đối soát Lotte.

### 2.4. Ca Trưởng

Ca trưởng là vai trò trung tâm của vận hành tại kiosk.

Chức năng:

- Mở ca.
- Nhập tồn đầu ca.
- Nhập kho nguyên liệu.
- Xuất mẻ chế biến/rang/nướng.
- Nhận thành phẩm.
- Đóng gói thành túi/hộp.
- Phân bổ túi/hộp cho từng PG/nhân viên.
- Thu hồi hàng trả lại từ PG.
- Ghi nhận hàng hư/hủy/hao hụt.
- Bàn giao ca.
- Chốt tồn cuối ca.
- Tạo báo cáo cuối ca/cuối ngày.
- Xuất báo cáo dạng ảnh infographic.
- Tạo yêu cầu bếp/yêu cầu đặt nguyên liệu.
- Xem nhanh tình trạng tồn kho và cảnh báo tồn thấp.

### 2.5. Bếp

Bếp sử dụng màn hình tablet hoặc desktop đơn giản, rõ ràng.

Chức năng:

- Nhận yêu cầu chế biến từ ca trưởng.
- Xem danh sách đơn mới, đang làm, đã xong.
- Xác nhận đã nhận đơn.
- Xác nhận hoàn thành.
- Ghi chú thiếu nguyên liệu hoặc vấn đề phát sinh.
- Có âm báo/thông báo khi có đơn mới.
- Màn hình hiển thị lớn, dễ thao tác khi đang làm bếp.

### 2.6. Nhân Viên Bán Hàng / PG

Nhân viên bán hàng thao tác chính trên mobile.

Chức năng:

- Đăng ký ca làm.
- Check-in/check-out.
- Xem ca làm của mình.
- Nhận hàng được ca trưởng phân bổ.
- Bán hàng qua POS nội bộ.
- Tạo mã hóa đơn nội bộ.
- Xem lịch sử hóa đơn của mình trong ca.
- Xem số lượng hàng đang giữ, đã bán, còn lại.

---

## 3. Master Data

Master Data phải cấu hình được trên giao diện, không cần sửa code.

### 3.1. Chi nhánh / kiosk

Thông tin cần quản lý:

- Mã chi nhánh.
- Tên chi nhánh.
- Địa chỉ.
- Trạng thái hoạt động.
- Quản lý phụ trách.
- Danh sách nhân viên thuộc chi nhánh.
- Cấu hình ca làm theo chi nhánh.

### 3.2. Sản phẩm / SKU

Thông tin cần quản lý:

- Mã SKU.
- Tên sản phẩm.
- Loại: nguyên liệu, bao bì, bán thành phẩm, thành phẩm.
- Đơn vị tính.
- Quy cách đóng gói.
- Trọng lượng quy đổi kg nếu có.
- Giá bán.
- Ngưỡng tồn kho tối thiểu.
- Trạng thái đang bán/ngưng bán.
- Hình ảnh sản phẩm.

### 3.3. Định mức chế biến và đóng gói

Hệ thống cần cấu hình:

- Nguyên liệu đầu vào.
- Thành phẩm đầu ra.
- Tỷ lệ hao hụt dự kiến.
- Quy đổi từ kg sang túi/hộp.
- Định mức bao bì cần dùng.

### 3.4. Cấu hình ca làm

Thông tin:

- Tên ca.
- Giờ bắt đầu.
- Giờ kết thúc.
- Số phút cho phép đi trễ.
- Số nhân viên khuyến nghị.
- Nhóm nhân viên áp dụng.
- Chi nhánh áp dụng.

---

## 4. POS Nội Bộ Và Đối Soát Lotte

### 4.1. POS bán hàng

Giao diện POS cần có:

- Lưới sản phẩm.
- Chọn số lượng nhanh.
- Giỏ hàng.
- Nút tạo đơn.
- Mã hóa đơn nội bộ.
- Lịch sử hóa đơn trong ca.

Logic đặc biệt:

- Không xử lý thanh toán tiền mặt/chuyển khoản.
- Khi bấm "Tạo đơn", hệ thống sinh Order ID.
- Hàng bán ra được trừ khỏi số lượng hàng nhân viên đang giữ.
- Order ID dùng để đối soát với bill/thanh toán tại quầy tổng Lotte.

### 4.2. Hủy/sửa đơn POS

Cần có quy trình:

- Hủy đơn khi nhập sai.
- Sửa số lượng/sản phẩm trước khi chốt ca.
- Ghi lý do hủy/sửa.
- Chỉ vai trò được cấp quyền mới được sửa/hủy.
- Tự động hoàn lại tồn khi hủy đơn.
- Lưu audit log đầy đủ.

### 4.3. Đối soát Lotte

Module đối soát cần có:

- Nhập tay hoặc import file doanh thu/bill từ quầy Lotte.
- Đối chiếu Order ID nội bộ với dữ liệu Lotte.
- Trạng thái:
  - Chưa đối soát
  - Đã khớp
  - Lệch số tiền
  - Lệch số lượng
  - Thiếu bill Lotte
  - Thiếu đơn nội bộ
  - Đã xử lý
- Báo cáo lệch theo ngày, chi nhánh, nhân viên, ca.
- Ghi chú xử lý lệch.
- Export báo cáo đối soát.

---

## 5. Quản Lý Kho Và Vận Hành Ca

### 5.1. Nhập kho

Ca trưởng hoặc người được phân quyền có thể:

- Nhập nguyên liệu.
- Nhập bao bì.
- Nhập thành phẩm.
- Ghi số lượng, đơn vị, ghi chú, ảnh chứng từ nếu cần.
- Gắn nhập kho với ngày vận hành và chi nhánh.

### 5.2. Chế biến

Luồng chế biến:

1. Chọn nguyên liệu đầu vào.
2. Nhập số lượng xuất chế biến.
3. Nhập thành phẩm nhận về.
4. Hệ thống tính hao hụt.
5. Ghi nhận hủy/hỏng nếu có.

### 5.3. Đóng gói

Luồng đóng gói:

1. Chọn bán thành phẩm/thành phẩm theo kg.
2. Chọn quy cách túi/hộp.
3. Nhập số lượng đóng gói.
4. Hệ thống trừ thành phẩm nguồn và bao bì.
5. Hệ thống cộng tồn túi/hộp bán ra.

### 5.4. Phân bổ hàng cho PG

Ca trưởng cần:

- Chọn nhân viên.
- Chọn nhiều loại túi/hộp.
- Nhập số lượng giao.
- Xem tổng hàng mỗi nhân viên đang giữ.
- Thu hồi hàng trả lại.
- Ghi nhận hàng hư/hủy.
- Hệ thống tự tính số đã bán dựa trên hóa đơn POS.

### 5.5. Bàn giao ca

Cuối ca:

- Hệ thống tính tồn dự kiến.
- Ca trưởng nhập tồn thực tế nếu khác.
- Ghi chú chênh lệch.
- Chụp ảnh minh chứng nếu cần.
- Chốt ca.
- Tồn cuối ca 1 tự động thành tồn đầu ca 2.

### 5.6. Kiểm kê

Chức năng:

- Kiểm kê theo chi nhánh.
- Ghi tồn thực tế theo từng sản phẩm.
- Tính chênh lệch so với hệ thống.
- Ghi lý do chênh lệch.
- Cảnh báo nếu lệch vượt ngưỡng.
- Cho phép quản lý duyệt chênh lệch lớn.

---

## 6. Đặt Hàng Và Yêu Cầu Bếp

### 6.1. Yêu cầu bếp

Ca trưởng có thể gửi yêu cầu:

- Sản phẩm cần làm.
- Số lượng.
- Thời gian cần.
- Ghi chú.

Bếp có thể:

- Xác nhận đã nhận.
- Chuyển sang đang làm.
- Đánh dấu hoàn thành.
- Hủy/từ chối kèm lý do nếu không đủ điều kiện.

### 6.2. Dự trù nguyên liệu / Purchase Order nội bộ

Ca trưởng hoặc quản lý có thể:

- Tạo danh sách nguyên liệu cần đặt cho ngày mai.
- Dựa trên tồn kho, bán ra, định mức, tồn tối thiểu.
- Gửi yêu cầu đặt hàng.
- Theo dõi trạng thái yêu cầu.

Trạng thái đề xuất:

- Draft
- Sent
- Acknowledged
- Fulfilled
- Cancelled

---

## 7. Chấm Công Và Lịch Làm

### 7.1. Đăng ký ca

Nhân viên có thể:

- Xem lịch dạng calendar.
- Đăng ký ca làm.
- Xem trạng thái ca đã đăng ký.
- Ghi chú khi đăng ký.

### 7.2. Check-in / check-out

Yêu cầu:

- Check-in nhanh trên mobile.
- Check-out nhanh.
- Có thể yêu cầu selfie.
- Có thể lưu GPS hoặc Wifi nội bộ.
- Ghi nhận thời gian thực tế.
- Tự tính đi trễ, thiếu check-out, vắng.

### 7.3. Ngoại lệ chấm công

Cần bổ sung:

- Xin nghỉ.
- Đổi ca.
- Tăng ca.
- Bổ sung công thủ công.
- Duyệt ngoại lệ.
- Ghi lý do chỉnh sửa.
- Lưu audit log.

---

## 8. Lương Và Hoa Hồng

### 8.1. Cấu hình lương

Cần cấu hình:

- Lương theo giờ.
- Lương cố định.
- Phụ cấp.
- Thưởng.
- Phạt.
- Công thức theo nhóm nhân viên.
- Công thức theo chi nhánh nếu cần.

### 8.2. Cấu hình hoa hồng

Cần cấu hình:

- Mục tiêu số lượng bán.
- Hoa hồng theo sản phẩm hoặc theo tổng số túi.
- Hoa hồng theo cấp bậc/vị trí.
- Thời gian áp dụng.
- Chi nhánh áp dụng.

### 8.3. Bảng lương

Hệ thống cần:

- Tự tổng hợp công.
- Tự tổng hợp doanh số/túi bán.
- Tự tính hoa hồng.
- Cho phép manual adjustment.
- Có ghi chú lý do chỉnh sửa.
- Cho phép chốt lương theo kỳ.
- Sau khi chốt, dữ liệu bị khóa nếu không có quyền mở khóa.
- Export CSV/Excel cho kế toán.

---

## 9. Báo Cáo Và Dashboard

### 9.1. Dashboard quản lý

Cần có:

- Doanh thu theo ngày/tuần/tháng.
- So sánh doanh thu giữa chi nhánh.
- Tỷ trọng bán hàng theo nhân viên.
- Mặt hàng bán chạy.
- Tồn kho realtime.
- Cảnh báo tồn thấp.
- Hao hụt chế biến.
- Đơn bếp/yêu cầu đặt hàng đang chờ.
- Chấm công bất thường.

### 9.2. Báo cáo cuối ca/cuối ngày

Báo cáo tự động tổng hợp:

- Tồn đầu ca.
- Nhập kho.
- Chế biến.
- Đóng gói.
- Phân bổ cho PG.
- Số bán theo POS.
- Số trả lại.
- Hư/hủy/hao hụt.
- Tồn cuối ca.
- Doanh thu ước tính.
- Chênh lệch kiểm kê.
- Ghi chú sự cố.

Nút xuất báo cáo:

- Xuất ảnh infographic.
- Có thể tải về hoặc gửi nhóm báo cáo.
- Nội dung đẹp, dễ đọc trên điện thoại.

### 9.3. Export dữ liệu

Các module cần hỗ trợ export:

- Bảng công.
- Bảng lương.
- Báo cáo kho.
- Báo cáo POS.
- Báo cáo đối soát Lotte.
- Báo cáo yêu cầu đặt hàng.
- Báo cáo doanh thu.

---

## 10. Thông Báo Và Nhắc Việc

Hệ thống cần có thông báo:

- Có đơn bếp mới.
- Tồn kho dưới ngưỡng tối thiểu.
- Nhân viên chưa check-in.
- Nhân viên quên check-out.
- Ca chưa bàn giao.
- Báo cáo cuối ngày chưa chốt.
- Có chênh lệch kiểm kê.
- Có đơn POS chưa đối soát.
- Có yêu cầu đặt hàng chờ xử lý.

Thông báo có thể hiển thị dạng:

- In-app notification.
- Âm báo tại màn hình bếp.
- Badge số lượng trên menu.
- Push notification trong giai đoạn sau nếu dùng PWA.

---

## 11. Audit Log Và Bảo Mật

### 11.1. Audit log

Cần ghi log cho các hành động:

- Đăng nhập/đăng xuất.
- Tạo/sửa/xóa nhân viên.
- Đổi quyền.
- Tạo/sửa/hủy hóa đơn POS.
- Nhập/xuất/điều chỉnh kho.
- Chốt ca/mở lại ca.
- Chốt báo cáo.
- Chốt/mở khóa bảng lương.
- Export dữ liệu.
- Duyệt/từ chối yêu cầu.

Thông tin log:

- Người thao tác.
- Thời gian.
- Module.
- Hành động.
- Dữ liệu trước.
- Dữ liệu sau.
- Lý do nếu có.

### 11.2. Bảo mật

Yêu cầu:

- Đăng nhập bằng tài khoản riêng.
- Mật khẩu không lưu plaintext.
- Reset mật khẩu an toàn.
- Khóa/mở tài khoản.
- Phân quyền theo vai trò và chi nhánh.
- RLS hoặc kiểm tra quyền phía backend.
- Dữ liệu nhạy cảm như lương chỉ người có quyền mới xem.
- Không xóa cứng dữ liệu nghiệp vụ quan trọng, ưu tiên soft delete.

---

## 12. Dữ Liệu Và Bảng Chính Đề Xuất

Danh sách bảng nghiệp vụ chính:

- users / profiles
- roles
- permissions
- role_permissions
- branches
- products
- product_prices
- product_recipes
- work_shifts
- shift_registrations
- attendance_records
- attendance_adjustments
- operation_days
- stock_movements
- inventory_counts
- bag_shift_sessions
- bag_allocations
- pos_orders
- pos_order_items
- lotte_reconciliation_batches
- lotte_reconciliation_lines
- supply_requests
- kitchen_orders
- commission_rules
- payroll_periods
- payroll_lines
- payroll_adjustments
- report_snapshots
- audit_logs
- system_settings

---

## 13. Quy Tắc Nghiệp Vụ Chính

### 13.1. Quy tắc tồn kho

- Tồn hiện tại = tồn đầu + nhập + thành phẩm + điều chỉnh tăng - xuất chế biến - xuất đóng gói - bán - hủy - điều chỉnh giảm.
- Tồn cuối ca đã chốt không được sửa nếu không có quyền mở khóa.
- Mọi điều chỉnh kho phải có lý do.

### 13.2. Quy tắc bán hàng

- Nhân viên chỉ bán trong phạm vi hàng đã được phân bổ.
- Không được tạo đơn vượt quá số lượng đang giữ.
- Tạo đơn POS sẽ trừ số lượng đang giữ.
- Hủy đơn sẽ hoàn lại số lượng nếu ca chưa khóa.
- Mã hóa đơn phải duy nhất theo ngày/chi nhánh.

### 13.3. Quy tắc bàn giao

- Ca sau nhận tồn từ ca trước.
- Nếu có chênh lệch, bắt buộc nhập lý do.
- Nếu chênh lệch vượt ngưỡng, cần quản lý duyệt.

### 13.4. Quy tắc lương

- Bảng lương lấy dữ liệu từ công thực tế và doanh số/túi bán.
- Manual adjustment bắt buộc có ghi chú.
- Sau khi chốt lương, chỉ người có quyền mới được mở khóa.

### 13.5. Quy tắc đối soát

- Mỗi đơn POS cần có trạng thái đối soát.
- Dữ liệu Lotte có thể nhập tay hoặc import.
- Chênh lệch phải được phân loại và ghi chú xử lý.

---

## 14. Tiêu Chí Nghiệm Thu Tổng Quan

Hệ thống được xem là đạt yêu cầu khi:

- Super Admin tạo được chi nhánh, sản phẩm, nhân viên, role và phân quyền động.
- Ca trưởng vận hành được đủ luồng: mở ca, nhập kho, chế biến, đóng gói, phân bổ PG, thu hồi, bàn giao, xuất báo cáo.
- Nhân viên bán hàng tạo được hóa đơn POS nội bộ và hệ thống trừ đúng hàng đang giữ.
- Bếp nhận và xử lý được yêu cầu từ ca trưởng.
- Quản lý xem được dashboard, tồn kho, chấm công, lương, hoa hồng, báo cáo.
- Hệ thống export được Excel/CSV/ảnh báo cáo theo yêu cầu.
- Hệ thống ghi audit log cho các hành động quan trọng.
- Hệ thống có phân quyền dữ liệu đúng theo chi nhánh và vai trò.
- Không có dữ liệu khách hàng vì phạm vi chỉ là vận hành nội bộ.

---

## 15. Prompt Triển Khai Chuyên Nghiệp Cho Đội Dev/UI

Thiết kế và phát triển hệ thống CRM/POS nội bộ cho chuỗi kiosk "Hạt Dẻ Ông Lý", tập trung vào vận hành bán hàng trong siêu thị Lotte. Đây không phải CRM khách hàng, mà là CRM nội bộ để quản lý chi nhánh, nhân sự, kho, bán hàng, bếp, chấm công, lương, hoa hồng, báo cáo và đối soát.

Yêu cầu giao diện:

- Thiết kế theo phong cách CRM/POS chuyên nghiệp, tương tự Sapo, KiotViet, CukCuk.
- Ưu tiên mobile-first vì nhân viên và ca trưởng dùng nhiều trên điện thoại.
- Không gom quá nhiều chức năng vào một trang dài.
- Mỗi chức năng chính phải là một trang/màn riêng, có route riêng, chuyển trang rõ ràng như app.
- Không lặp lại nhiều thanh công cụ trong cùng một màn.
- Sidebar desktop và bottom navigation mobile phải gọn, chỉ hiện đúng chức năng theo vai trò.
- Giữ nguyên màu thương hiệu hiện tại.
- Hỗ trợ nút chuyển đổi ngôn ngữ.

Phân quyền:

- Có 5 vai trò chính: Admin hệ thống, Quản lý, Ca trưởng, Bếp, Nhân viên.
- Admin hệ thống mới được tạo nhân sự, tạo role, tick quyền chi tiết theo module và cấu hình master data.
- Quản lý chỉ xem và xử lý số liệu vận hành: doanh thu, kho, bán hàng, bảng công, lương, hoa hồng, đặt hàng, báo cáo.
- Ca trưởng vận hành ca: nhập kho, chế biến, đóng gói, phát túi cho PG, nhận hàng trả lại, bàn giao ca, xuất báo cáo infographic.
- Bếp nhận và xử lý yêu cầu chế biến.
- Nhân viên chỉ có Bán hàng và Chấm công.

Trang Quản lý:

- Sau đăng nhập, Quản lý vào thẳng Dashboard Doanh thu.
- Dashboard có bộ lọc ngày/chi nhánh.
- Có biểu đồ so sánh doanh thu giữa các chi nhánh.
- Có biểu đồ tròn thể hiện tỷ trọng bán hàng của nhân viên trong một chi nhánh.
- Số lượng khách được hiểu là số hóa đơn và hiển thị theo khung giờ hóa đơn.
- Các trang quản lý phải tách riêng: Doanh thu, Kinh doanh, Kho, Bảng công, Lương, Đặt hàng.
- Chức năng Lương chỉ hiển thị bảng lương, hoa hồng, điều chỉnh, tổng chi lương và export kế toán; không trộn báo cáo khác.
- Chấm công trong phần quản lý chỉ hiển thị bảng công nhân viên.
- Danh sách báo cáo chỉ nằm trong trang/chức năng Báo cáo, không hiển thị thường trực ở mọi chức năng.

Trang Nhân viên:

- Nhân viên chỉ thấy Bán hàng và Chấm công.
- Bán hàng dạng menu POS: chạm tên món, nhập số lượng, thêm nhiều món vào hóa đơn.
- Không có thanh toán tiền mặt/QR/chuyển khoản.
- Khi bấm tạo hóa đơn, hệ thống sinh mã hóa đơn riêng để đối soát với quầy Lotte.
- Tạo hóa đơn sẽ trừ số túi nhân viên đang giữ.

Trang Ca trưởng:

- Một ngày có thể lặp nhiều lần các bước lấy mẻ rang/chế biến và phát túi cho nhân viên.
- Cuối ca mới tổng hợp số lượng bán, số trả lại, số hư/hủy và tồn còn lại.
- Ca 2 nhận dữ liệu tồn từ ca 1 và tiếp tục vận hành.
- Báo cáo cuối ngày tự lấy dữ liệu từ thao tác trong ngày, ca trưởng không phải nhập lại thủ công.
- Có nút xuất infographic để lưu/gửi báo cáo.

Trang Kho:

- Xem tồn kho từng chi nhánh.
- Xem tồn mỗi ngày của chi nhánh.
- Có cảnh báo tồn thấp, chênh lệch kiểm kê, hao hụt chế biến, nhập/xuất theo kỳ.
- Dữ liệu kho phải đồng bộ với nhập kho, chế biến, đóng gói, phát túi, bán hàng và bàn giao ca.

Trang Bếp:

- Giao diện chuyên nghiệp, rõ ràng, dễ dùng trên tablet.
- Tách đơn mới, đang làm, đã xong.
- Tổng hợp được khối lượng cần làm theo ngày/chi nhánh.

Kiến trúc dữ liệu:

- Thiết kế database chuẩn hóa, dễ migrate sang Google Cloud SQL.
- Có bảng master data cho chi nhánh, sản phẩm, menu, giá bán, định mức, phân quyền.
- Có audit log cho các hành động quan trọng.
- Có Data Dictionary để bàn giao.
