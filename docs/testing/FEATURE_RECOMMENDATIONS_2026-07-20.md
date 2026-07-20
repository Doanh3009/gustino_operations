# Đề xuất tính năng và điều chỉnh toàn hệ thống — 2026-07-20

Các đề xuất dưới đây dựa trên source, bug tracker và luồng đang có. Đây là backlog, không phải thay đổi business logic đã được tự động áp dụng.

## Đề xuất bổ sung từ drill-down thi đua

- **Drill-down 3 tầng có đối chiếu**: bảng xếp hạng → từng ngày/ca → hóa đơn hoặc phiếu giao túi nguồn. Ở mỗi tầng hiển thị tổng nguồn, chênh lệch và dữ liệu chưa gắn được nhân sự/ca.
- **Hộp thư khiếu nại KPI/thưởng**: nhân viên chọn đúng kỳ và nguồn doanh thu để gửi yêu cầu xem lại; quản lý phản hồi, đính kèm bằng chứng và lưu lịch sử, không sửa trực tiếp số đã chốt.
- **Kỳ thi đua có trạng thái**: đang chạy → chờ đối soát → đã duyệt → đã khóa. Mở khóa phải có lý do và audit; công thức KPI hiện tại chỉ được thay đổi sau quyết định nghiệp vụ.
- **So sánh công bằng theo điều kiện làm việc**: bộ lọc vai trò, loại hợp đồng, số ca, ngày thường/cuối tuần và chi nhánh; vẫn giữ bảng doanh thu gốc, chỉ thêm góc nhìn so sánh.
- **Phát hiện dữ liệu không được ghi nhận**: danh sách hóa đơn ngoài cửa sổ ca, hóa đơn thiếu người bán, phiếu giao túi thiếu `employeeId`, tên trùng và nguồn bị lệch khỏi tổng xếp hạng.
- **Xuất biên bản thi đua**: Excel/PDF gồm tổng hạng, KPI áp dụng, thưởng và sheet nguồn chi tiết; gắn thời điểm xuất, người xuất và trạng thái kỳ.
- **Mục tiêu/chương trình theo kỳ**: cho cấu hình chiến dịch riêng ngoài KPI lương (ví dụ sản phẩm trọng tâm), nhưng tuyệt đối không trộn thưởng chiến dịch vào KPI hiện tại nếu chưa có quy tắc được duyệt.

## Bổ sung sau đợt kiểm tra kho/chấm công/thi đua

- **Tách “tồn vật lý” và “lượng có thể bán/đóng gói”**: cùng một dòng hiển thị số g/kg vật lý, số gói tối đa có thể tạo theo quy cách và phần dư chưa đủ đóng gói. Không tự làm tròn hoặc tự trừ tồn.
- **Trang chẩn đoán chấm công cho Admin**: mỗi lần thất bại lưu mã truy vết và đúng công đoạn (quyền camera, đọc ảnh, GPS, độ chính xác, lấy địa chỉ, tải ảnh, ghi bản ghi, đồng bộ lại), nhưng không lưu ảnh/tọa độ nhạy cảm vào log lỗi ngoài phạm vi được phép. Nhân viên có nút “Kiểm tra thiết bị” trước ca để thử quyền camera/GPS/mạng mà không tạo bản ghi công.
- **Bảng thi đua có drill-down và kỳ đã chốt**: bấm một nhân sự/ngày để xem hóa đơn nguồn; cho biết dữ liệu cập nhật lần cuối và khóa kỳ sau khi Admin duyệt. Giữ Top doanh thu tách biệt với điều kiện thưởng KPI hiện tại.

## P0 — cần xử lý trước khi mở rộng

1. **Một nguồn tồn kho chuẩn và giao dịch nguyên tử**
   - Khôi phục `create_stock_movements_checked` theo số kiểm kê gần nhất và khóa đồng thời từng SKU.
   - Chốt quy tắc liên kết POS ↔ hàng xuất kho ↔ tồn bàn giao để tránh vừa không trừ vừa trừ hai lần.
   - Có màn đối chiếu bắt buộc: tồn đầu + nhập − xuất − hủy = tồn cuối, kèm người xử lý chênh lệch.

2. **Theo dõi lỗi và đồng bộ có mã truy vết**
   - Mỗi lần lưu có request ID, trạng thái đang chờ/đã lưu/thất bại và nút thử lại an toàn.
   - Ghi lỗi frontend/API/RPC vào một bảng/log tập trung; Admin xem được lỗi 400/401/409/500 theo thời gian, người dùng và chức năng.
   - Cảnh báo ngay khi dữ liệu realtime bị ngắt và cho biết lần đồng bộ thành công gần nhất.

3. **Đóng các rủi ro phân quyền đang mở**
   - Bỏ cơ chế LAN tin `X-User-*` khi token không hợp lệ (BUG-003).
   - Xác nhận chính thức Manager quản lý toàn bộ hay chỉ chi nhánh được gán (BUG-002) rồi đồng bộ frontend, API và RLS.
   - Nhật ký audit thống nhất cho xóa/sửa kho, chấm công, tài khoản, lương, KPI và báo cáo đã chốt.

4. **Sao lưu và khôi phục có kiểm chứng**
   - Sao lưu tự động, chính sách lưu giữ, bản xuất định kỳ và diễn tập khôi phục trên môi trường tách biệt.
   - Không chỉ kiểm tra “backup đã chạy”; cần kiểm tra bản backup thực sự đọc/khôi phục được.

## P1 — giá trị vận hành cao

5. **Mua hàng đầy đủ thay cho danh sách yêu cầu đơn giản**
   - Yêu cầu → duyệt → đơn mua → nhà cung cấp xác nhận → nhận hàng → nhập kho.
   - Danh mục nhà cung cấp, giá gần nhất, lead time, đơn vị quy đổi, giao thiếu/giao dư và công nợ.
   - Excel/PDF theo bộ lọc và lịch sử thay đổi; Admin theo dõi, bộ phận vận hành mới được thao tác trạng thái theo phân quyền.

6. **Kiểm kê bằng mã vạch/QR và phiếu chênh lệch**
   - Quét SKU, nhập nhanh theo khu vực, lưu nháp, khóa phiếu khi chốt.
   - Chênh lệch không tự điều chỉnh âm thầm; tạo phiếu điều chỉnh có lý do và người duyệt.

7. **Đối soát tiền cuối ca**
   - Tách tiền mặt/QR/thẻ, tiền khách đưa/tiền thừa, số thực đếm và chênh lệch.
   - Đối chiếu doanh thu POS với báo cáo ca, hoàn/hủy hóa đơn và sổ quỹ.

8. **Trung tâm cảnh báo hành động**
   - Tồn thấp, tồn âm, ca chưa checkout, đơn bếp quá hạn, báo cáo chưa chốt, doanh thu bất thường, lỗi đồng bộ.
   - Mỗi cảnh báo mở đúng bản ghi cần xử lý, có người nhận và trạng thái đã xử lý.

9. **Dashboard theo vai trò**
   - Admin: doanh thu, biên lợi nhuận ước tính, tồn, thất thoát, nhân sự, lỗi hệ thống.
   - Manager: chi nhánh/ngày/ca, so sánh với kỳ trước và mục tiêu.
   - Ca trưởng/nhân viên/bếp: chỉ việc cần làm trong ca hiện tại.

10. **Doanh thu và KPI dễ kiểm toán**
    - Lưu/hiển thị theo ngày, có bộ lọc ngày–tuần–tháng–chi nhánh–nhân viên.
    - Cho mở từ tổng ngày xuống danh sách hóa đơn nguồn, nhưng mặc định không bắt người dùng đọc từng hóa đơn.
    - Mỗi khoản thưởng có dòng giải thích: doanh thu nguồn, mục tiêu áp dụng, tỷ lệ, ngưỡng và công thức; khóa kỳ sau khi duyệt.

## P2 — tăng trưởng và chất lượng sản phẩm

11. **Khách hàng và loyalty**
    - Hồ sơ khách, lịch sử mua, điểm/hạng, voucher, sinh nhật và đồng ý nhận marketing.
    - Cần chính sách dữ liệu cá nhân và quyền xuất/xóa phù hợp trước khi triển khai.

12. **Giá vốn, định mức và lợi nhuận**
    - Recipe/version theo thời gian, giá nhập bình quân, hao hụt chuẩn và lãi gộp theo món/chi nhánh/ngày.
    - Đây là thay đổi business lớn; phải được chủ doanh nghiệp duyệt công thức trước khi code.

13. **Lịch làm và chấm công nâng cao**
    - Đổi ca/xin nghỉ/tăng ca có phê duyệt, cảnh báo trùng ca và thiếu người.
    - Khóa kỳ chấm công/lương; mọi sửa sau khóa cần lý do và audit.

14. **Offline-first có kiểm soát**
    - Hàng đợi cục bộ cho POS/chấm công/kho, idempotency key và màn xem bản ghi chưa đồng bộ.
    - Không hiển thị thành công khi server chưa xác nhận; xử lý xung đột rõ ràng.

15. **Trợ năng và thiết bị di động**
    - Chuẩn WCAG cơ bản: bàn phím, focus, tương phản, nhãn form, vùng bấm ≥44px và bảng có chế độ card trên màn nhỏ.
    - Bộ ảnh kiểm thử chuẩn cho 360/390/430/768/1024/1440px.

## Điều chỉnh kỹ thuật nên làm theo từng đợt nhỏ

- Tiếp tục tách `AdminPage.tsx` và `ManagerDashboardPage.tsx` thành route/module độc lập; không refactor một lần quá lớn.
- Chia `styles.css` theo module và design token; hiện nhiều lớp override nối tiếp làm tăng nguy cơ tràn và regression.
- Bổ sung unit test cho hàm tồn/KPI/doanh thu, integration test cho RPC/RLS và E2E theo vai trò trên môi trường QA tách biệt.
- Thiết lập CI bắt buộc: TypeScript, focused regressions, build, bundle guard, migration static audit và visual snapshots.
- Có môi trường staging với dữ liệu giả lập, không dùng production để thử thao tác phá hủy.

## Thứ tự triển khai khuyến nghị

1. P0 tồn kho + lỗi đồng bộ + phân quyền + backup.
2. Mua hàng/nhận hàng, đối soát tiền và trung tâm cảnh báo.
3. Dashboard/doanh thu/KPI kiểm toán được.
4. Offline, mobile/accessibility và tự động hóa kiểm thử.
5. Loyalty, giá vốn/lợi nhuận và mở rộng tăng trưởng sau khi business rule được phê duyệt.
