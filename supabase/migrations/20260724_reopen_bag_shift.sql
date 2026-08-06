-- Mở lại ca vận hành đã chốt nhầm (BUG-114).
--
-- Ca trưởng rất hay bấm nhầm "Chốt & bàn giao ca". Trước bản này, ca đã chốt là
-- kẹt cứng: không bán tiếp được, không phát túi được, và check-out cũng vướng vì
-- ca vận hành không còn khớp thực tế. Cách chữa duy nhất là sửa tay dưới DB.
--
-- Mở lại phải HOÀN TÁC đúng những gì lệnh chốt đã ghi, nếu không chốt lần hai sẽ
-- cộng số liệu kho hai lần:
--   1. phiếu kiểm đếm cuối ca (`count`, document_id = id phiên ca)
--   2. phiếu bán/hỏng sinh từ đối soát túi (document_id = id phiếu phát túi)
--   3. dấu `posted_at` trên phiếu phát túi
-- KHÔNG đụng tới `settled_at`: đối soát túi là thao tác riêng, có trước lúc chốt.

create or replace function public.reopen_bag_shift(
  p_session_id uuid,
  p_reason text default ''
)
returns public.bag_shift_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  session_row public.bag_shift_sessions;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_stamp text := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI');
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then
    raise exception 'Chua dang nhap';
  end if;

  select * into session_row from public.bag_shift_sessions where id = p_session_id for update;
  if session_row.id is null then
    raise exception 'Khong tim thay ca can mo lai';
  end if;

  if not (
    (actor.role in ('manager', 'admin') and public.can_manage_branch(session_row.branch_id))
    or (actor.role = 'shift_leader' and actor.branch_id = session_row.branch_id)
  ) then
    raise exception 'Khong co quyen mo lai ca tai chi nhanh nay';
  end if;

  -- Đã mở sẵn thì trả về luôn: nút bấm hai lần không được sinh lỗi.
  if session_row.status <> 'closed' then
    return session_row;
  end if;

  -- Chỉ sửa được ca trong ngày. Ngày cũ đã vào báo cáo/bảng lương nên phải đi
  -- đường mở lại ngày vận hành của quản lý, không mở lén từng ca.
  if session_row.business_date <> v_today then
    raise exception 'Chi mo lai duoc ca trong ngay hom nay. Ca ngay % phai nho quan ly mo lai ngay van hanh.', session_row.business_date;
  end if;

  if exists (
    select 1 from public.operation_days d
    where d.branch_id = session_row.branch_id
      and d.business_date = session_row.business_date
      and d.status = 'closed'
  ) then
    raise exception 'Ngay van hanh da chot. Hay mo lai ngay truoc khi mo lai ca.';
  end if;

  -- 1. Gỡ phiếu kiểm đếm cuối ca do lệnh chốt sinh ra.
  delete from public.stock_movements
  where document_id = p_session_id
    and movement_type = 'count';

  -- 2. Gỡ phiếu bán/hỏng do lệnh chốt đẩy từ phiếu phát túi.
  delete from public.stock_movements
  where movement_type in ('sale_out', 'waste')
    and document_id in (
      select allocation.id
      from public.bag_allocations allocation
      where allocation.shift_id = p_session_id
         or allocation.settlement_shift_id = p_session_id
    );

  -- 3. Trả phiếu phát túi về trạng thái chưa đẩy kho để lần chốt sau ghi lại đủ.
  update public.bag_allocations
  set posted_at = null
  where (shift_id = p_session_id or settlement_shift_id = p_session_id)
    and posted_at is not null;

  update public.bag_shift_sessions
  set status = 'open',
      ended_at = null,
      closing_balances = '{}'::jsonb,
      discrepancy_note = trim(
        coalesce(discrepancy_note, '')
        || ' [MỞ LẠI ' || v_stamp || ' bởi ' || coalesce(actor.full_name, 'nguoi dung')
        || coalesce(': ' || v_reason, '') || ']'
      )
  where id = p_session_id
  returning * into session_row;

  return session_row;
end;
$$;

grant execute on function public.reopen_bag_shift(uuid, text) to authenticated;

notify pgrst, 'reload schema';
