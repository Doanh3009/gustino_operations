# Tích hợp báo cáo ca với Zalo qua n8n

Trạng thái: **Đã nối code ảnh infographic → n8n; còn kiểm thử end-to-end thật, chưa deploy**.

Phần tạo/chốt báo cáo theo ca hoạt động theo quy tắc: Ca 1 tạo một ảnh; Ca 2 tạo ảnh Ca 2 và Tổng ngày. Web dùng chính component `ReportPoster` đang hiển thị, không có mẫu ảnh thứ hai. Server đưa từng ảnh sang n8n; n8n lưu Drive/Sheet và node Zalo hiện có chịu trách nhiệm gửi.

## Lịch n8n đã khóa phía server

| Loại | Giờ gửi |
|---|---:|
| Ca 1 | 15:15 |
| Ca 2 | 22:00 |
| Tổng ngày | 22:15 |

Múi giờ payload là UTC+7 (`+07:00`). Nếu ca trưởng chốt sau giờ đã định, dòng `READY` đã quá hạn sẽ được workflow quét phút gửi ở lượt kế tiếp.

## Cấu hình n8n server-only

```dotenv
N8N_REPORT_WEBHOOK_URL=https://n8n-cua-ban/webhook/gustino-report-ready
N8N_REPORT_WEBHOOK_TOKEN=token-header-auth
N8N_REPORT_ENABLED=true
```

Không đặt các biến này dưới tiền tố `VITE_`. Trình duyệt chỉ gửi ảnh cùng token phiên đăng nhập vào API cùng origin; API xác minh ca đã đóng và snapshot đã lưu rồi mới thêm Header Auth bí mật khi gọi n8n.

Trong node **Webhook** của n8n, cấu hình chính xác:

- `HTTP Method`: `POST`.
- `Path`: `gustino-report-ready` (phải khớp URL production trong `.env.local`).
- `Authentication`: `Header Auth`.
- Credential Header Auth — `Name`: `x-gustino-token`.
- Credential Header Auth — `Value`: đúng nguyên văn giá trị `N8N_REPORT_WEBHOOK_TOKEN`, không tự thêm `Bearer`, không thêm dấu nháy hoặc khoảng trắng.
- `IP(s) Whitelist`: để trống trong lúc kiểm thử; nếu bật, IP public của máy gọi phải được cho phép.
- Save rồi Publish/Activate workflow; dùng **Production URL** `/webhook/...`.

Lưu ý: chữ `x-gustino-token` đang hiện trong dropdown **Credential for Header Auth** có thể chỉ là tên hiển thị của credential, không chứng minh trường Header `Name` bên trong đã đúng. Phải bấm biểu tượng bút chì cạnh dropdown, mở credential và kiểm tra trực tiếp cả `Name` lẫn `Value`.

Với luồng cần xác nhận Drive/Sheet đã ghi thành công, đặt `Respond = When Last Node Finishes`. `Immediately` chỉ xác nhận workflow bắt đầu, nên web có thể báo thành công dù Convert/Drive/Sheet lỗi phía sau. Ở đầu node hãy chuyển sang **Production URL**; không dùng `/webhook-test/...` và không bấm `Listen for test event` khi GUSTINO đang gọi URL production `/webhook/...`.

Nếu web báo HTTP 403 thì request đã tới n8n nhưng bị từ chối trước workflow. Kiểm tra lại Header Auth Name/Value và IP whitelist; sau khi đổi `.env.local` phải chạy lại `npm run dev` để server nạp token mới.

Tài liệu n8n chính thức: [Webhook node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) và [Webhook credentials](https://docs.n8n.io/integrations/builtin/credentials/webhook/).

Google Sheet dùng `job_key` dạng `branch:date:report_type` để upsert. Snapshot cũng ghi trạng thái từng `shift-1`, `shift-2`, `day`; gọi lại ảnh đã queue thành công không tạo job mới. Nếu queue lỗi, trang báo cáo hiện nút **Gửi lại ảnh Zalo**.

Sau khi báo cáo ca đã được chốt, nút **Gửi ngay Zalo** luôn hiện. Nút này yêu cầu xác nhận vì có thể gửi trùng nếu workflow đã xử lý trước đó; nó giữ nguyên `job_key`, thêm `send_now=true` và đặt `send_at` bằng thời điểm hiện tại UTC+7. Lịch tự động 15:15/22:00/22:15 không thay đổi. Workflow quét Sheet mỗi phút sẽ xử lý yêu cầu gửi ngay ở lượt kế tiếp.

Nếu n8n báo `Referenced node doesn't exist`, biểu thức đang gọi tên một node đã bị xóa hoặc đổi tên. Với workflow hiện tại, node cập nhật Sheet chọn `Column to match = job_key`, nên trường `job_key (using to match)` phải lấy đúng `job_key` từ node `Limit1`:

```javascript
{{ $('Limit1').first().json.job_key }}
```

Không đặt `.json.row_number` vào ô này: giá trị dòng không thể khớp cột `job_key`. Chạy node `Limit1` trước để phần INPUT có dữ liệu; nếu tên node thực tế khác, kéo thả `job_key` từ đúng node đang tồn tại vào ô thay vì gõ tên thủ công. Tên node trong biểu thức phải khớp tuyệt đối.

Nếu biểu thức trên bị xám và `Limit1` không có INPUT, chưa được test node cập nhật cuối. Nhánh này chỉ chạy sau khi Sheet đã có dòng `READY`. Phải kiểm tra nhánh tạo dòng trước theo thứ tự **Webhook → Convert to File → Upload file → Append or update row in sheet**. Khi nhánh Webhook đã tạo được dòng, chạy lại nhánh quét phút thì `Get row(s)`, `Limit1` và node cập nhật cuối mới có dữ liệu.

Trong node `Append or update row in sheet`, mọi trường động phải chuyển sang **Expression (fx)**. Nếu để Fixed, Google Sheet sẽ nhận nguyên văn `{{ ... }}`. Mapping chuẩn:

| Cột | Giá trị | Chế độ |
|---|---|---|
| `job_key` | `{{ $('Webhook').first().json.body.job_key }}` | Expression |
| `branch_id` | `{{ $('Webhook').first().json.body.branch_id }}` | Expression |
| `branch_name` | `{{ $('Webhook').first().json.body.branch_name }}` | Expression |
| `business_date` | `{{ $('Webhook').first().json.body.business_date }}` | Expression |
| `report_type` | `{{ $('Webhook').first().json.body.report_type }}` | Expression |
| `report_label` | `{{ $('Webhook').first().json.body.report_label }}` | Expression |
| `send_at` | `{{ $('Webhook').first().json.body.send_at }}` | Expression |
| `drive_file_id` | `{{ $('Upload file').first().json.id }}` | Expression |
| `file_name` | `{{ $('Webhook').first().json.body.file_name }}` | Expression |
| `status` | `READY` | Fixed |
| `attempts` | `0` | Fixed |

Sau khi sửa, xóa dòng test chứa chuỗi `{{ ... }}`, Save/Publish workflow và bấm `Gửi ngay Zalo` lại.

### Cho Codex sửa workflow bằng n8n Public API

Khi Browser của Codex không điều khiển được VS Code Simple Browser, chủ dự án có thể tạo một API key tạm trong n8n và tự đặt vào `.env.local`:

```dotenv
N8N_API_KEY=api-key-tao-trong-n8n
```

Không gửi key qua chat, không đặt tiền tố `VITE_` và không commit. Codex sẽ dùng header chính thức `X-N8N-API-KEY`, tải và sao lưu workflow trước, chỉ sửa node mapping liên quan, đọc lại để xác minh rồi mới activate/publish. Sau khi xong có thể thu hồi API key tạm.

Nếu `GET /api/v1/workflows?limit=1` trả HTTP 400 `{"message":"Invalid URL"}` ngay cả khi không gửi key, lỗi nằm ở Public API/request validator hoặc reverse proxy của máy chủ n8n, không phải do giá trị key. Không được PUT workflow khi chưa GET và lưu được bản backup. Chủ máy chủ cần kiểm tra `N8N_EDITOR_BASE_URL`, `N8N_HOST`, `N8N_PROTOCOL`, `N8N_PATH`, `N8N_PROXY_HOPS`, Public API/reverse-proxy settings và khởi động lại hoặc nâng cấp n8n; với dịch vụ thuê ngoài thì gửi nhà cung cấp đúng response 400 này để họ sửa.

## Cách test local an toàn

1. Publish/Activate workflow n8n và kiểm tra timezone `Asia/Ho_Chi_Minh`.
   - `.env.local` đang dùng URL production dạng `/webhook/...`, vì vậy **không bấm Execute workflow/Listen for test event**. Chế độ đó chỉ chờ URL `/webhook-test/...` và sẽ quay mãi dù production webhook hoạt động.
   - Sau khi bật **Active**, kiểm tra lượt nhận ở mục **Executions**.
2. Chạy lại `npm run dev` sau khi đổi `.env.local`.
3. Dùng một ca test thật, hoàn tất ảnh cuối ca/Bàn giao rồi bấm **Chốt báo cáo**.
4. Kiểm tra Drive có JPG, Sheet có `status=READY`, `send_at` đúng loại báo cáo.
5. Để test không gửi vào nhóm, tạm ngắt node Zalo hoặc đổi nhóm test trước khi chốt.
6. Sau node Zalo thành công, Sheet phải thành `SENT`; chạy lại không được gửi trùng cùng `job_key`.

Không tạo payload giả khi workflow đang trỏ vào group thật vì thời gian cố định có thể đã quá hạn và ảnh sẽ được gửi ngay.

## Luồng OA/GMF trực tiếp cũ

Server local và API server vẫn giữ endpoint GMF chính thức để fallback tin nhắn chữ khi n8n chưa được cấu hình. Tài liệu Zalo OA chưa công khai contract gửi ảnh trực tiếp vào GMF, nên ứng dụng không suy đoán endpoint ảnh. Khi `N8N_REPORT_ENABLED=false`, hệ thống chỉ ghi trạng thái n8n đang tắt và không tự gửi fallback để tránh gửi nhầm trong lúc test.

## Cấu hình OA/GMF chữ nếu cần fallback

Tạo file `.env.local` (file này đã nằm trong `.gitignore`) và tự nhập hai giá trị sau:

```dotenv
ZALO_OA_ACCESS_TOKEN=access-token-cua-oa
ZALO_GMF_GROUP_ID=id-nhom-gmf
```

Sau đó tắt và chạy lại `npm run dev` để server local đọc secret. Không gửi token qua chat, không đặt tên biến bắt đầu bằng `VITE_`, và không commit `.env.local`.

Luồng hiện tại gửi đúng 3 tin nhắn/ngày khi có đủ hai ca. Access token là token ngắn hạn; đây là cấu hình phù hợp để chủ dự án test trước khi deploy.

API không chỉ tin vào nút trên giao diện: server tự kiểm tra token người dùng, role, chính ca của ca trưởng đã đóng, snapshot báo cáo đã tồn tại và quy tắc Ca 1/Ca 2. Kết quả gửi thành công được ghi vào snapshot; lần gọi lại cùng `shift_id` không gửi trùng.

## Chủ dự án cần chuẩn bị

1. Tạo hoặc dùng một Zalo Official Account đã xác thực.
2. Đăng ký gói nhóm GMF cho OA và tạo/chọn nhóm nhận báo cáo.
3. Tại [Zalo for Developers](https://developers.zalo.me/), tạo ứng dụng, liên kết OA và xin quyền quản lý thông tin nhóm.
4. Để test ngay, lấy `ZALO_OA_ACCESS_TOKEN` và `ZALO_GMF_GROUP_ID`. Để vận hành lâu dài sau này, chuẩn bị thêm:
   - `ZALO_APP_ID`
   - `ZALO_APP_SECRET`
   - `ZALO_OA_REFRESH_TOKEN`
   - `ZALO_GMF_GROUP_ID`
5. Hỏi Zalo OA Support hoặc đầu mối GMF cung cấp tài liệu/contract chính thức cho thao tác **gửi ảnh vào nhóm GMF**. Cần xác nhận URL endpoint, request body, loại `attachment_id` được hỗ trợ và quyền ứng dụng cần có.

Không gửi `APP_SECRET`, access token hay refresh token qua chat và không đặt chúng trong biến `VITE_*`. Các giá trị này phải nằm trong secret của Supabase Edge Function hoặc server backend.

## Luồng xác thực bắt buộc

- Access token OA chỉ có thời hạn ngắn; backend phải dùng refresh token và lưu lại refresh token mới sau mỗi lần xoay token.
- Dùng API lấy danh sách thành viên nhóm để kiểm tra `ZALO_GMF_GROUP_ID` và quyền ứng dụng trước khi bật gửi tự động.
- Chỉ đánh dấu “đã gửi” sau khi Zalo trả response thành công; lỗi phải được ghi log và cho phép retry idempotent theo `shift_id`.

## Luồng OA trực tiếp dự kiến sau khi có contract ảnh

1. Ca trưởng kết ca thành công và dữ liệu ca đã được chốt.
2. Backend tạo/lấy ảnh báo cáo đúng `shift_id`.
3. Backend tải ảnh lên Zalo để nhận `attachment_id` nếu contract GMF yêu cầu.
4. Backend gửi ảnh vào đúng `group_id`.
5. Lưu `shift_id`, thời điểm gửi, Zalo message ID và trạng thái; retry không được gửi trùng.

## Tài liệu Zalo chính thức đã đối chiếu

- [Xác thực và ủy quyền cho ứng dụng](https://stc-developers.zdn.vn/docs/v2/official-account/bat-dau/xac-thuc-va-uy-quyen-cho-ung-dung-new)
- [Gửi tin nhắn chữ vào nhóm GMF](https://stc-developers.zdn.vn/docs/v2/official-account/nhom-chat-gmf/tin-nhan/text_message)
- [Lấy danh sách thành viên nhóm GMF](https://stc-developers.zdn.vn/docs/v2/official-account/nhom-chat-gmf/quan-ly/get_list_member)
- [Upload hình ảnh cho Zalo OA](https://stc-developers.zdn.vn/docs/v2/official-account/tin-nhan/quan-ly-tin-nhan/upload-hinh-anh)
