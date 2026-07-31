-- Google 的 refresh token 存放处。
-- 关键：故意不给 select 策略 —— 浏览器只能写、读不回来，只有 Edge Function（service role）读得到。
create table if not exists public.gcal_tokens (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at   timestamptz not null default now()
);

alter table public.gcal_tokens enable row level security;

drop policy if exists "insert own" on public.gcal_tokens;
create policy "insert own" on public.gcal_tokens
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own" on public.gcal_tokens;
create policy "update own" on public.gcal_tokens
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own" on public.gcal_tokens;
create policy "delete own" on public.gcal_tokens
  for delete to authenticated
  using (auth.uid() = user_id);
