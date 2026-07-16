# AGENTS.md — Repository Testing Workflow

## Purpose

This repository uses the reusable testing workflow in `docs/testing/`.

When asked to review, test, debug, or continue testing this repository, read these files first:

1. `docs/testing/CODEX_TESTING_INSTRUCTIONS.md`
2. `docs/testing/TESTING_CONFIG.md`
3. `docs/testing/PROJECT_PROFILE.md`
4. `docs/testing/MODULE_INDEX.md`
5. `docs/testing/TEST_PROGRESS.md`
6. `docs/testing/BUG_TRACKER.md`
7. `docs/testing/SESSION_HANDOFF.md`

## Mandatory rules

- Discover the actual project structure from source code. Do not assume the framework, modules, routes, database, or test tooling.
- Work module by module.
- Create test cases, implement automated tests where practical, execute tests, identify bugs, fix bugs, and verify fixes.
- A bug must have evidence from source code, a reproducible test, command output, logs, API responses, database results, or UI evidence. Never report speculative bugs as confirmed bugs.
- Update the Markdown tracking files immediately after each completed test batch, confirmed bug, fix, verification, blocker, or important decision.
- Do not wait until the end of a session to update progress.
- Process as much as possible in each session, but leave the repository in a resumable state at all times.
- Do not mark a module complete while any confirmed Critical or High bug remains unresolved unless it is explicitly marked `Blocked` with evidence and a concrete unblock condition.
- Never claim 100% coverage unless measured evidence proves it.
- Never run destructive tests against production data or production services.
- Prefer minimal, targeted fixes. Run targeted tests and relevant regression tests after each fix.
- Preserve unrelated user changes. Do not reset, overwrite, or revert unrelated work.

## Entry point

Follow `docs/testing/CODEX_TESTING_INSTRUCTIONS.md`.

## RÀNG BUỘC BẢO TOÀN LOGIC NGHIỆP VỤ

Mục tiêu của quá trình này là phát hiện và sửa bug, không phải thiết kế lại hệ thống hoặc thay đổi quy trình nghiệp vụ.

Khi sửa bug, bắt buộc tuân thủ:

1. Không tự ý thay đổi business logic, quy trình nghiệp vụ, trạng thái nghiệp vụ, công thức tính toán, phân quyền, luồng phê duyệt hoặc cách dữ liệu được xử lý.

2. Không thay đổi hành vi hiện tại chỉ vì cho rằng một cách khác hợp lý, tối ưu hoặc đẹp hơn.

3. Không thêm, xóa hoặc đổi quy tắc nghiệp vụ nếu không có bằng chứng rõ ràng từ:

   * source code liên quan;
   * database schema, constraint hoặc migration;
   * tài liệu nghiệp vụ đang được repository sử dụng;
   * test hiện có;
   * yêu cầu trực tiếp của người dùng.

4. Chỉ được sửa lỗi triển khai khiến hệ thống không thực hiện đúng logic nghiệp vụ hiện có, ví dụ:

   * điều kiện code bị sai;
   * xử lý null hoặc dữ liệu biên bị lỗi;
   * truy vấn sai;
   * mất dữ liệu;
   * tính toán sai so với công thức đã tồn tại;
   * phân quyền không đúng với rule đã có;
   * frontend và backend không đồng nhất;
   * transaction, concurrency hoặc đồng bộ dữ liệu bị lỗi;
   * exception hoặc lỗi runtime;
   * validation được định nghĩa nhưng triển khai sai.

5. Không được sửa business logic chỉ để automated test pass.

6. Nếu automated test mâu thuẫn với source code hoặc quy trình nghiệp vụ hiện tại, không tự ý chọn một phía rồi sửa. Phải:

   * đánh dấu test là `Needs Business Confirmation`;
   * ghi rõ điểm mâu thuẫn;
   * cung cấp bằng chứng;
   * không thay đổi logic liên quan;
   * tiếp tục xử lý các test case khác không bị blocker.

7. Nếu một bug có nhiều cách sửa, phải chọn cách:

   * thay đổi ít nhất;
   * giữ nguyên hành vi hợp lệ hiện tại;
   * không ảnh hưởng các module khác;
   * không thay đổi API contract nếu không cần thiết;
   * không thay đổi dữ liệu lịch sử nếu không có migration an toàn.

8. Không được thực hiện các thay đổi sau nếu chưa có sự cho phép trực tiếp của người dùng:

   * refactor lớn;
   * đổi kiến trúc;
   * đổi database schema;
   * đổi API contract;
   * đổi role hoặc permission;
   * đổi công thức doanh thu, KPI, hoa hồng, tồn kho hoặc chấm công;
   * đổi thứ tự các bước nghiệp vụ;
   * thêm trạng thái nghiệp vụ mới;
   * xóa trạng thái hoặc quy tắc đang có.

9. Nếu xác định rằng việc sửa bug bắt buộc phải thay đổi logic nghiệp vụ, không được tự sửa. Phải:

   * ghi bug và bằng chứng;
   * đánh dấu trạng thái `Blocked — Requires Business Decision`;
   * mô tả logic hiện tại;
   * mô tả thay đổi cần thiết;
   * nêu phạm vi ảnh hưởng;
   * chờ người dùng phê duyệt.

10. Sau mỗi fix phải chạy regression test để xác nhận:

    * bug đã được sửa;
    * các hành vi hợp lệ trước đây vẫn được giữ nguyên;
    * không có business flow liên quan bị thay đổi ngoài ý muốn.

Nguyên tắc cuối cùng:

> Chỉ sửa implementation để hệ thống thực hiện đúng logic đã tồn tại. Không tự ý sửa, bổ sung hoặc diễn giải lại logic nghiệp vụ.
