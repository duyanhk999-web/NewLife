-- 006: vá 2 lỗ hổng tiền tệ.
-- (1) Client đã đăng nhập tự INSERT được profile với cash/bank tuỳ ý
--     (policy profiles_insert_own + trigger chỉ chặn UPDATE).
-- (2) Các RPC là SECURITY DEFINER nên current_user luôn là chủ hàm: đoạn kiểm
--     tra p_user_id = auth.uid() trong 003 không bao giờ chạy, người này gọi
--     RPC trên ví người khác được.
-- Server game dùng service_role nên không bị ảnh hưởng.

drop policy if exists "profiles_insert_own" on public.profiles;
revoke insert on public.profiles from anon, authenticated;

revoke execute on function public.rpc_starter_grant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.rpc_shop_buy(uuid, text, integer, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.rpc_atm_transfer(uuid, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.rpc_starter_grant(uuid, uuid) to service_role;
grant execute on function public.rpc_shop_buy(uuid, text, integer, uuid, boolean) to service_role;
grant execute on function public.rpc_atm_transfer(uuid, text, bigint, uuid) to service_role;
