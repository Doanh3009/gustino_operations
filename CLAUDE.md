# CLAUDE.md — Báo cáo thực tập tốt nghiệp GUSTINO

## 1. Nhiệm vụ chính

Hãy đọc toàn bộ các tài liệu được cung cấp và hoàn thiện **báo cáo thực tập tốt nghiệp ngành Công nghệ thông tin** cho sinh viên **Quách Khả Doanh – MSSV 3122411025**, với đề tài:

> **XÂY DỰNG VÀ HOÀN THIỆN HỆ THỐNG QUẢN LÝ VẬN HÀNH GUSTINO**

Phải làm trực tiếp trên file mẫu:

`TTTN_Mau9_QuachKhaDoanh_3122411025.docx`

File mẫu này là nguồn quy định cao nhất về cấu trúc, biểu mẫu và cách trình bày. Không tạo một mẫu báo cáo khác và không thay đổi cấu trúc bốn chương của trường.

Mục tiêu đầu ra:

1. Một file Word hoàn chỉnh dựa trên đúng file mẫu.
2. Một file PDF duy nhất chứa toàn bộ báo cáo.
3. Một file Markdown tổng hợp các thông tin, hình ảnh và tài liệu còn thiếu.

---

## 2. Thứ tự ưu tiên nguồn thông tin

Khi viết báo cáo, sử dụng nguồn theo thứ tự sau:

1. File mẫu của Trường Đại học Sài Gòn.
2. Mã nguồn, migration, schema, tài liệu và lịch sử commit của dự án GUSTINO.
3. Nhật ký công việc, nội dung trao đổi và hình ảnh do sinh viên cung cấp.
4. Website chính thức hoặc nguồn công khai có thể kiểm chứng.
5. Phân tích chuyên môn suy ra trực tiếp từ mã nguồn.

Không được tự suy đoán để lấp chỗ trống.

Khi thiếu dữ liệu, ghi đúng dạng:

`[CẦN BỔ SUNG: mô tả chính xác thông tin cần cung cấp]`

Khi thiếu hình:

`[CẦN BỔ SUNG HÌNH X.Y: tên hình – màn hình cần chụp – nội dung cần thể hiện – dữ liệu cần che]`

Tiếp tục hoàn thiện các phần còn lại, không dừng toàn bộ công việc chỉ vì thiếu một vài thông tin.

---

## 3. Thông tin đã xác nhận

### 3.1. Sinh viên

- Họ và tên: **Quách Khả Doanh**
- MSSV: **3122411025**
- Trường: **Trường Đại học Sài Gòn**
- Khoa: **Khoa Công nghệ Thông tin**
- Ngành: **Công nghệ thông tin**
- Chương trình đào tạo: **Chất lượng cao**
- Lớp: `[CẦN BỔ SUNG]`
- Niên khóa: `[CẦN BỔ SUNG]`
- Thời gian thực tập: `[CẦN BỔ SUNG NGÀY BẮT ĐẦU VÀ KẾT THÚC]`
- Vị trí thực tập chính thức: `[CẦN BỔ SUNG HOẶC XÁC NHẬN]`
- Phòng ban thực tập: `[CẦN BỔ SUNG]`

### 3.2. Đơn vị thực tập

- Tên công ty: **Công ty TNHH Khoa Học Kỹ Thuật Vạn Thịnh**
- Địa chỉ: **Số 42 Đường số 48, Phường Tân Tạo, Thành phố Hồ Chí Minh**
- Người hướng dẫn tại doanh nghiệp: **Trương Chí Cường**
- Chức vụ người hướng dẫn: `[CẦN BỔ SUNG]`
- Giảng viên hướng dẫn: **Trương Tấn Khoa**
- Học hàm, học vị: `[CẦN BỔ SUNG NẾU MẪU YÊU CẦU]`

Cách mô tả bắt buộc:

> **Công ty TNHH Khoa Học Kỹ Thuật Vạn Thịnh thuộc hệ sinh thái Thống Đạt Group.**

Không sử dụng các cách diễn đạt sau nếu không có tài liệu pháp lý chứng minh:

- Công ty con của Thống Đạt Group.
- Công ty mẹ – công ty con.
- Thống Đạt Group sở hữu Công ty Vạn Thịnh.
- Công ty thành viên về mặt pháp lý.
- Tỷ lệ góp vốn hoặc sở hữu.

Có thể giới thiệu ngắn gọn Thống Đạt Group là một hệ sinh thái hoạt động đa ngành. Phải phân biệt rõ thông tin của tập đoàn với thông tin pháp nhân của Công ty Vạn Thịnh.

### 3.3. Dự án thực tập

- Tên đề tài: **Xây dựng và hoàn thiện hệ thống quản lý vận hành GUSTINO**
- Loại sản phẩm: Website quản lý vận hành nội bộ.
- Bối cảnh sử dụng: Hỗ trợ hoạt động vận hành GUSTINO trong lĩnh vực F&B.
- Đối tượng sử dụng có thể gồm nhân viên, ca trưởng và quản lý; chỉ dùng đúng tên vai trò xuất hiện trong mã nguồn hoặc tài liệu thực tế.

Các nhóm nghiệp vụ có thể xuất hiện trong dự án:

- Quản lý nhân sự và tài khoản.
- Phân quyền người dùng.
- Đăng ký lịch làm việc.
- Chấm công và kiểm tra vị trí.
- Quản lý ca làm việc.
- Bàn giao giữa các ca trưởng.
- Báo cáo giữa các ca và báo cáo cuối ca.
- Bán hàng, hóa đơn và sản phẩm.
- Quản lý kho, nhập kho, xuất kho và kiểm kê.
- Đặt hàng hoặc yêu cầu bổ sung hàng.
- Dashboard doanh thu, doanh số và báo cáo quản trị.
- Quản lý chi nhánh.
- Đồng bộ dữ liệu theo thời gian thực.
- Báo cáo dành cho thực tập sinh IT.
- Tích hợp n8n hoặc workflow tự động.
- Giao diện responsive trên điện thoại.
- Triển khai hệ thống lên môi trường thực tế.

Danh sách trên chỉ là gợi ý kiểm tra. Không mặc định tất cả chức năng đều đã hoàn thành hoặc đều phải xuất hiện trong báo cáo.

---

## 4. Nguyên tắc viết báo cáo

### 4.1. Tập trung vào quá trình thực tập

Báo cáo phải làm rõ:

- Nhiệm vụ doanh nghiệp giao.
- Vai trò và phần việc trực tiếp của sinh viên.
- Quy trình tiếp nhận yêu cầu.
- Giải pháp đã lựa chọn.
- Công việc phân tích, xây dựng, chỉnh sửa và kiểm thử.
- Kết quả đạt được.
- Khó khăn và cách xử lý.
- Bài học và nhận xét cá nhân.

Không biến báo cáo thành:

- Giáo trình giới thiệu React, Supabase hoặc các công nghệ khác.
- Báo cáo đồ án phần mềm thuần túy.
- Tài liệu quảng cáo doanh nghiệp.
- Danh sách chức năng không có phân tích.

Phần lý thuyết công nghệ chỉ trình bày ngắn gọn và phải gắn trực tiếp với cách công nghệ được sử dụng trong dự án.

### 4.2. Không bịa thông tin

Không tự tạo:

- Lịch sử hoặc cột mốc công ty.
- Cơ cấu tổ chức.
- Quy mô nhân sự.
- Đối tác.
- Số chi nhánh.
- Doanh thu hoặc số liệu vận hành.
- Chức vụ của người hướng dẫn.
- Công nghệ không có trong mã nguồn.
- Chức năng chưa được triển khai.
- Số người dùng.
- Kết quả kiểm thử.
- Tỷ lệ cải thiện hiệu suất.
- Ngày triển khai production.
- Quan hệ sở hữu pháp lý giữa các doanh nghiệp.
- Chữ ký, con dấu, nhận xét hoặc điểm đánh giá.

Không đưa vào báo cáo:

- Mật khẩu.
- API key.
- Access token.
- Secret key.
- Service role key.
- Dữ liệu cá nhân của nhân viên.
- Dữ liệu doanh thu thật nếu chưa được phép công bố.

### 4.3. Phân biệt trạng thái công việc

Mỗi chức năng hoặc lỗi phải được mô tả đúng trạng thái:

- Đã xây dựng.
- Đã chỉnh sửa.
- Đã kiểm thử trên môi trường phát triển.
- Đã triển khai.
- Đang hoàn thiện.
- Chưa có đủ bằng chứng xác nhận.
- Có trong yêu cầu nhưng chưa có trong mã nguồn.

Không dùng cụm từ “đã hoàn thành hoàn toàn” nếu chưa có kiểm thử và xác nhận trên môi trường thực tế.

---

## 5. Cấu trúc báo cáo theo mẫu SGU

Giữ nguyên thứ tự trong file mẫu:

1. Trang bìa.
2. Trang lót bìa.
3. Mục lục.
4. Nhận xét của chuyên gia doanh nghiệp.
5. Nhận xét của giảng viên hướng dẫn.
6. Lời mở đầu.
7. Chương 1.
8. Chương 2.
9. Chương 3.
10. Chương 4.
11. Tài liệu tham khảo.
12. Phụ lục.

Không xóa các trang nhận xét và không tự viết nội dung nhận xét thay cho người hướng dẫn.

### LỜI MỞ ĐẦU

Viết khoảng 1–2 trang, gồm:

- Bối cảnh ứng dụng công nghệ thông tin trong quản lý vận hành.
- Nhu cầu số hóa quy trình trong lĩnh vực F&B.
- Lý do chọn đề tài.
- Mục tiêu thực tập.
- Phạm vi công việc.
- Phương pháp thực hiện.
- Ý nghĩa thực tiễn.
- Cấu trúc báo cáo.

---

# CHƯƠNG 1. GIỚI THIỆU

## 1.1. Giới thiệu công ty thực tập

Bám theo các gợi ý trong file mẫu:

- Thông tin chung về công ty.
- Địa chỉ và thông tin liên hệ nếu có.
- Cơ sở vật chất.
- Cơ cấu tổ chức.
- Lĩnh vực hoạt động.
- Sản phẩm hoặc dịch vụ quan trọng.
- Đối tác nếu được phép công bố.
- Một số quy trình liên quan đến công việc thực tập.
- Bộ phận tiếp nhận sinh viên.
- Thông tin ngắn về người hướng dẫn.
- Những nội dung sinh viên cần học hỏi thêm.

Yêu cầu riêng:

- Chỉ trình bày lịch sử, cơ cấu và lĩnh vực hoạt động khi có nguồn.
- Không lấy quy mô hoặc lịch sử của Thống Đạt Group để gán cho Công ty Vạn Thịnh.
- Có thể giới thiệu GUSTINO và thương hiệu Hạt Dẻ Ông Lý ở mức phục vụ bối cảnh đề tài.
- Không biến phần giới thiệu thành quảng cáo.

## 1.2. Nhiệm vụ thực tập

Trình bày các nhiệm vụ thực tế được giao, có thể gồm:

- Tìm hiểu quy trình vận hành GUSTINO.
- Phân tích yêu cầu website nội bộ.
- Tìm hiểu mã nguồn và công nghệ.
- Tham gia xây dựng và hoàn thiện chức năng.
- Chỉnh sửa chức năng kho.
- Hoàn thiện chức năng chấm công.
- Xây dựng báo cáo giữa các ca.
- Hoàn thiện bàn giao ca trưởng.
- Chỉnh sửa cơ chế realtime.
- Sửa lỗi theo phản hồi người dùng.
- Kiểm thử trên máy tính và điện thoại.
- Hỗ trợ triển khai và cập nhật hệ thống.
- Tìm hiểu hoặc tích hợp n8n khi có bằng chứng.

Với từng nhóm nhiệm vụ, ưu tiên mô tả:

- Mục tiêu.
- Công việc sinh viên thực hiện.
- Công cụ hoặc công nghệ sử dụng.
- Kết quả.
- Khó khăn.
- Cách xử lý.

Kết thúc bằng **KẾT LUẬN CHƯƠNG 1**.

---

# CHƯƠNG 2. PHÂN TÍCH, XÂY DỰNG VÀ HOÀN THIỆN HỆ THỐNG QUẢN LÝ VẬN HÀNH GUSTINO

Đây là phần chính của báo cáo.

Tự tổ chức các mục và tiểu mục dựa trên mã nguồn và công việc thực tế. Không bắt buộc dùng toàn bộ danh sách bên dưới.

Cấu trúc gợi ý:

## 2.1. Bối cảnh và vấn đề thực tế

Mô tả những khó khăn có căn cứ trong việc quản lý lịch làm, chấm công, ca làm việc, bán hàng, kho, bàn giao và báo cáo.

## 2.2. Khảo sát và phân tích yêu cầu

Trình bày:

- Đối tượng sử dụng.
- Phương pháp tiếp nhận yêu cầu.
- Yêu cầu chức năng.
- Yêu cầu phi chức năng.
- Quy tắc nghiệp vụ.
- Phạm vi thực hiện trong kỳ thực tập.
- Phân quyền theo vai trò.

## 2.3. Giải pháp đề xuất

Mô tả giải pháp tổng thể, phạm vi và giới hạn của website quản lý vận hành nội bộ.

## 2.4. Công nghệ và kiến trúc

Đọc mã nguồn trước khi viết.

Chỉ trình bày công nghệ thực sự có trong dự án. Với mỗi công nghệ, giải thích ngắn gọn:

- Vai trò.
- Vị trí sử dụng.
- Lý do phù hợp với dự án.

Trình bày kiến trúc frontend, API/backend, cơ sở dữ liệu, xác thực, lưu trữ, realtime, workflow và môi trường triển khai nếu có.

## 2.5. Dữ liệu và cơ sở dữ liệu

Dựa vào schema, migration và truy vấn trong mã nguồn để trình bày:

- Nhóm bảng chính.
- Quan hệ dữ liệu.
- Ý nghĩa nghiệp vụ.
- Ràng buộc.
- Cơ chế phân quyền dữ liệu.
- Cơ chế realtime nếu có.

Không công khai thông tin bí mật.

## 2.6. Hiện thực các chức năng chính

Chọn những chức năng có vai trò quan trọng và có đủ bằng chứng.

Với mỗi chức năng, trình bày theo cấu trúc ngắn gọn:

1. Bài toán hoặc yêu cầu.
2. Quy trình nghiệp vụ.
3. Giải pháp kỹ thuật.
4. Giao diện hoặc luồng xử lý.
5. Phần việc của sinh viên.
6. Kết quả.
7. Khó khăn và cách xử lý.

Không bắt buộc viết tất cả chức năng theo cùng một độ dài.

## 2.7. Tiếp nhận và sửa lỗi

Chỉ đưa các lỗi có bằng chứng từ mã nguồn, nhật ký hoặc phản hồi người dùng.

Các lỗi cần kiểm tra trong dự án có thể gồm:

- Xóa nhân sự làm danh sách hiển thị trắng.
- Bàn giao giữa hai ca bị lỗi.
- Bàn giao tại một số chi nhánh không ổn định.
- Chấm công phản hồi chậm.
- Định vị chấm công chưa chính xác.
- Dashboard không cập nhật dữ liệu mới theo thời gian thực.
- Giao diện đặt hàng trên điện thoại bị tràn chữ.
- Workflow n8n hoặc đồng bộ dữ liệu bị lỗi.

Với mỗi lỗi, ghi:

- Hiện tượng.
- Điều kiện xảy ra.
- Ảnh hưởng.
- Nguyên nhân tìm được.
- Phương án xử lý.
- Cách kiểm thử.
- Trạng thái hiện tại.

Nếu mới sửa local, phải ghi rõ chưa xác nhận trên production.

## 2.8. Kiểm thử và triển khai

Trình bày:

- Phạm vi kiểm thử.
- Test case quan trọng.
- Kiểm thử chức năng.
- Kiểm thử phân quyền.
- Kiểm thử dữ liệu.
- Kiểm thử responsive.
- Kiểm thử sau sửa lỗi.
- Quy trình build và triển khai.
- Kiểm tra sau triển khai.
- Biện pháp bảo mật.

Chỉ ghi kết quả thực tế khi có bằng chứng. Nếu chưa có, dùng:

`[CẦN KIỂM THỬ VÀ BỔ SUNG KẾT QUẢ]`

## 2.9. Nhận xét cá nhân

Đánh giá:

- Mức độ phù hợp của giải pháp.
- Khả năng ứng dụng.
- Hạn chế hiện tại.
- Những vấn đề chưa giải quyết.
- Kỹ năng đã vận dụng.
- Bài học khi làm việc với người dùng thật.
- Sự khác biệt giữa bài tập học thuật và dự án doanh nghiệp.

Kết thúc bằng **KẾT LUẬN CHƯƠNG 2**.

---

# CHƯƠNG 3. KẾT QUẢ THỰC TẬP

## 3.1. Kết quả công việc

Tổng hợp:

- Công việc đã thực hiện.
- Chức năng đã xây dựng hoặc chỉnh sửa.
- Lỗi đã xử lý.
- Công nghệ đã học.
- Sản phẩm đã bàn giao.
- Trạng thái triển khai.

Không dùng tỷ lệ phần trăm hoàn thành nếu không có căn cứ.

## 3.2. Kiến thức và kỹ năng đạt được

Trình bày kết quả về:

- Phân tích nghiệp vụ.
- Thiết kế giao diện.
- Lập trình.
- Cơ sở dữ liệu.
- Kiểm thử.
- Triển khai.
- Git và GitHub.
- Xử lý lỗi.
- Giao tiếp với người dùng.
- Tự nghiên cứu công nghệ.

## 3.3. Kết quả thực tập hàng tuần

Mỗi tuần là một nhóm riêng, không gộp nhiều tuần thành một đoạn tổng hợp.

Dựa trên nhật ký thật để lập bảng:

- Tuần và thời gian.
- Công việc được giao.
- Công việc đã thực hiện.
- Kết quả.
- Khó khăn.
- Hướng xử lý.

Nếu thiếu mốc thời gian, ghi rõ phần cần bổ sung.

Giữ vị trí đính kèm các biểu mẫu của trường:

- Mẫu 6: Bảng ghi nhận kết quả thực tập hằng tuần.
- Mẫu 7: Bảng đánh giá quá trình thực tập tốt nghiệp.
- Mẫu 8: Phiếu đánh giá kết quả thực tập tốt nghiệp.

Nếu file hiện tại chỉ nhắc tên nhưng không chứa đầy đủ Mẫu 6, 7, 8, không tự thiết kế biểu mẫu thay thế. Ghi chú yêu cầu sinh viên cung cấp bản chính thức.

Không tự chấm điểm, viết nhận xét, tạo chữ ký hoặc con dấu.

Kết thúc bằng **KẾT LUẬN CHƯƠNG 3**.

---

# CHƯƠNG 4. KẾT LUẬN VÀ KIẾN NGHỊ

## 4.1. Kết luận

Tổng kết:

- Mục tiêu thực tập.
- Công việc đã thực hiện.
- Kết quả đạt được.
- Kiến thức và kỹ năng đã học.
- Hạn chế còn tồn tại.
- Mức độ hoàn thành nhiệm vụ.

Không tuyên bố hệ thống đã hoàn thiện tuyệt đối.

## 4.2. Kiến nghị với doanh nghiệp

Đề xuất mang tính xây dựng, có thể liên quan đến:

- Chuẩn hóa tài liệu và quy trình nghiệp vụ.
- Xây dựng môi trường kiểm thử.
- Tăng cường kiểm thử trước triển khai.
- Chuẩn hóa dữ liệu giữa các chi nhánh.
- Tài liệu hướng dẫn người dùng.
- Sao lưu và phục hồi dữ liệu.
- Bảo mật và phân quyền.
- Theo dõi lỗi và workflow tự động.
- Tối ưu giao diện điện thoại.

## 4.3. Kiến nghị với nhà trường

Đề xuất ngắn gọn về:

- Tăng nội dung thực hành dự án.
- Phân tích nghiệp vụ.
- Kiểm thử.
- Triển khai.
- Quản lý phiên bản.
- Làm việc với người dùng doanh nghiệp.

## 4.4. Định hướng phát triển

Phân biệt rõ đây là định hướng, không phải chức năng đã hoàn thành.

Kết thúc báo cáo bằng tài liệu tham khảo và phụ lục theo file mẫu.

---

## 6. Hình ảnh, bảng và tài liệu tham khảo

### Hình ảnh

Tại mỗi nội dung cần minh họa, tự đặt ghi chú hình phù hợp.

Các nhóm hình nên kiểm tra:

- Công ty và nơi làm việc.
- Sơ đồ tổ chức.
- Quy trình nghiệp vụ.
- Kiến trúc hệ thống.
- Sơ đồ cơ sở dữ liệu.
- Giao diện các chức năng chính.
- Giao diện trên điện thoại.
- Workflow n8n.
- Lỗi trước và sau khi sửa.
- Kết quả triển khai.

Không bắt buộc phải có tất cả. Chỉ yêu cầu hình có giá trị minh họa cho nội dung thực tế.

Mỗi hình phải:

- Được đánh số theo chương.
- Có tên hình.
- Được nhắc đến trong nội dung.
- Che dữ liệu cá nhân hoặc dữ liệu nhạy cảm.

### Bảng

Bảng phải được đánh số theo chương và có tiêu đề.

Có thể sử dụng các bảng:

- Danh sách tác nhân.
- Yêu cầu chức năng.
- Yêu cầu phi chức năng.
- Phân quyền.
- Quy tắc nghiệp vụ.
- Test case.
- Kết quả công việc.
- Nhật ký thực tập hàng tuần.

### Tài liệu tham khảo

Chỉ đưa tài liệu thực sự đã dùng.

Ưu tiên:

- Website chính thức của Thống Đạt Group.
- Nguồn công khai đáng tin cậy về Công ty Vạn Thịnh.
- Tài liệu chính thức của công nghệ có trong mã nguồn.
- Giáo trình hoặc tài liệu học thuật có trích dẫn.

Không tạo nguồn tham khảo giả.

---

## 7. Quy định trình bày

Tuân thủ toàn bộ quy định ở cuối file mẫu, bao gồm:

- Khổ giấy A4, in một mặt.
- Font Times New Roman.
- Lề trái 3 cm.
- Lề phải 2 cm.
- Lề trên 2 cm.
- Lề dưới 2 cm.
- Giãn dòng từ 1.3 đến 1.5.
- Số trang ở giữa cuối trang.
- Trang 1 bắt đầu từ Lời mở đầu.
- Các trang trước đó dùng số La Mã, trừ bìa và lót bìa.
- Mục lục tự động.
- Hình và bảng đánh số theo chương.
- Chỉ mục tối đa 4 cấp.

Định dạng tiêu đề:

- Chương: cỡ 16, in đậm, chữ hoa.
- Mục x.1: cỡ 14, in đậm, chữ hoa.
- Mục x.1.1: cỡ 13, in đậm.
- Mục x.1.1.1: cỡ 13, in nghiêng.

Không làm hỏng style, section break, header, footer hoặc cơ chế đánh số trang của file mẫu.

---

## 8. Văn phong

Sử dụng văn phong:

- Học thuật nhưng dễ đọc.
- Khách quan.
- Có phân tích và liên kết giữa các đoạn.
- Phù hợp với sinh viên CNTT năm cuối.
- Không khoa trương.
- Không quảng cáo.
- Không lặp ý để kéo dài số trang.

Dùng nhất quán một cách xưng hô, ưu tiên “sinh viên”.

Không viết quá nhiều định nghĩa lý thuyết chung.

---

## 9. Quy trình thực hiện trong Claude Code

1. Sao lưu file Word mẫu trước khi chỉnh sửa.
2. Đọc toàn bộ file mẫu và xác định section, style, mục lục, đánh số trang và vị trí các biểu mẫu.
3. Đọc toàn bộ tài liệu và mã nguồn dự án.
4. Lập bảng dữ liệu đã có và còn thiếu.
5. Xây dựng nội dung báo cáo theo đúng bốn chương.
6. Chèn nội dung vào bản sao của file mẫu, không phá định dạng.
7. Đánh dấu vị trí cần hình hoặc thông tin bổ sung.
8. Kiểm tra chéo nội dung với mã nguồn.
9. Kiểm tra tên, MSSV, công ty, người hướng dẫn và giảng viên.
10. Kiểm tra mục lục, heading, số trang, bảng, hình và tài liệu tham khảo.
11. Xuất Word và một file PDF duy nhất.
12. Tạo `THONG_TIN_CAN_BO_SUNG.md`.

Tên file đầu ra đề xuất:

- `Bao_cao_TTTN_QuachKhaDoanh_3122411025.docx`
- `Bao_cao_TTTN_QuachKhaDoanh_3122411025.pdf`
- `THONG_TIN_CAN_BO_SUNG.md`

---

## 10. Nội dung file THONG_TIN_CAN_BO_SUNG.md

Tổng hợp theo bảng:

| STT | Chương/mục | Loại | Nội dung cần bổ sung | Mục đích | Người xác nhận |
|---|---|---|---|---|---|
| 1 | ... | Thông tin/Hình/Tài liệu | ... | ... | Sinh viên/Doanh nghiệp/Giảng viên |

Nhóm riêng:

- Thông tin sinh viên còn thiếu.
- Thông tin doanh nghiệp cần xác nhận.
- Hình ảnh cần chụp.
- Test case cần chạy.
- Kết quả cần xác nhận trên production.
- Mẫu 6, Mẫu 7, Mẫu 8 cần cung cấp.
- Nội dung không nên công khai.

---

## 11. Kiểm tra cuối cùng

Trước khi hoàn tất, xác nhận:

- Đúng file mẫu SGU.
- Đủ bốn chương.
- Không thêm hoặc đổi thứ tự chương.
- Đúng họ tên và MSSV.
- Đúng tên công ty.
- Đúng người hướng dẫn và giảng viên.
- Không gọi Công ty Vạn Thịnh là công ty con.
- Chức năng và công nghệ khớp mã nguồn.
- Không có dữ liệu bí mật.
- Không có số liệu bịa.
- Không có nhận xét, chữ ký, con dấu giả.
- Các phần thiếu được đánh dấu rõ.
- File Word còn chỉnh sửa được.
- File PDF là một file duy nhất.
