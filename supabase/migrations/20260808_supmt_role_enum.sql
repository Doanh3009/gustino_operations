-- Vai trò SUP MT (Supervisor Market Trade) — giám sát vận hành thị trường.
--
-- Frontend đã có `supmt` trong `Role` từ 2026-08-04 nhưng enum `app_role` của DB thì
-- CHƯA BAO GIỜ có giá trị này, nên `profiles.role = 'supmt'` không insert được: không
-- thể tạo nổi một tài khoản SUP MT thật. File này bổ sung giá trị enum.
--
-- Để riêng một migration: Postgres không cho DÙNG giá trị enum vừa thêm trong cùng
-- transaction, mà các policy ở `20260808_supmt_readonly_access.sql` phải so sánh với
-- 'supmt'::app_role. Hai file = hai transaction là cách duy nhất chạy được một lượt.
alter type public.app_role add value if not exists 'supmt';
