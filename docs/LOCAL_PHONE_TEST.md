# Mở bản local GUSTINO trên điện thoại

Trạng thái kiểm tra ngày 2026-07-13:

- Máy tính: `192.168.100.32`
- Web local: `http://192.168.100.32:5173/`
- API local: `http://192.168.100.32:5177/api/health`
- Web và API đều trả HTTP 200 từ máy tính; server đang lắng nghe trên `0.0.0.0`.
- Windows Firewall đã cho phép `node.exe` nhận TCP trên cả mạng Public và Private.

## Cách mở trên iPhone

1. Kết nối iPhone vào cùng Wi-Fi với máy tính. IP điện thoại phải cùng dải `192.168.100.*`.
2. Mở Safari và nhập đúng `http://192.168.100.32:5173/`.
3. Không nhập `localhost`, `127.0.0.1`, cổng `5177` hoặc link Vercel cũ. Link Vercel chưa có các thay đổi local vì chưa được phép deploy.
4. Nếu Safari không mở được, tạm tắt VPN/Private Relay và kiểm tra Wi-Fi không bật chế độ cô lập thiết bị.
5. Giữ máy tính bật và tiến trình `npm.cmd run dev` đang chạy trong lúc thử.

Lưu ý: IP `192.168.100.32` có thể đổi sau khi máy tính kết nối lại Wi-Fi. Chạy `ipconfig` và lấy dòng `IPv4 Address` của adapter Wi-Fi để cập nhật URL.

Camera qua ô chọn/chụp file có thể hoạt động trên HTTP LAN, nhưng một số quyền nhạy cảm của trình duyệt (đặc biệt định vị) có thể yêu cầu HTTPS. Nếu trang mở được nhưng Safari từ chối GPS, cần dùng một HTTPS test URL/tunnel hoặc staging; việc đó phải được chủ dự án cho phép riêng và không đồng nghĩa deploy production.
