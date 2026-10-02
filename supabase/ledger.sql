-- 共享账本：和 Lance 一起记账
--
-- 她：「我想要和 Lance 共享这个账单，他可以增加我也可以，他可以看到全部内容，我也可以……
--      我可以随时终止和他的 share」「最好是有个后台可以显示历史记录，就是谁做了啥」。
--
-- 用法：Supabase 后台 → SQL Editor → 把这整个文件粘进去 → Run。跑几次都行（全是 if not exists / or replace）。
--
-- 结构：
--   ledgers         一本账（主人是开共享的那个人）
--   ledger_members  主人拉进来的人，按 Google 登录邮箱认
--   ledger_items    一笔一行：t = 流水，x = 税务记录，c = 设置（分类规则、周期账、账户……）
--   ledger_log      谁在什么时候加 / 改 / 删了哪一笔 —— 由触发器写，网页写不了也删不了
--
-- 谁能干什么，由下面的行级安全（RLS）在数据库里强制执行，不靠网页自觉：
--   · 主人和成员：能读这本账的全部内容，能加、能改、能删（删 = 打 deleted 标记）
--   · 只有主人：能拉人、踢人、把整本账关掉
--   · 被踢掉的人：下一次请求起就什么都读不到、写不进
--   · 历史记录：成员和主人都能看，谁都改不了

create extension if not exists pgcrypto;

create table if not exists public.ledgers (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  owner_email text,
  owner_name  text,
  name        text default '家庭账本',
  created_at  timestamptz not null default now()
);

create table if not exists public.ledger_members (
  ledger_id uuid not null references public.ledgers on delete cascade,
  email     text not null,                    -- 一律小写
  name      text,                             -- 主人给起的称呼，比如 Lance
  added_at  timestamptz not null default now(),
  primary key (ledger_id, email)
);

create table if not exists public.ledger_items (
  ledger_id  uuid not null references public.ledgers on delete cascade,
  k          text not null,
  id         text not null,
  data       jsonb,
  deleted    boolean not null default false,
  created_by text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (ledger_id, k, id)
);
create index if not exists ledger_items_since on public.ledger_items (ledger_id, updated_at);

create table if not exists public.ledger_log (
  seq       bigserial primary key,
  ledger_id uuid not null references public.ledgers on delete cascade,
  at        timestamptz not null default now(),
  who       text,
  act       text not null,                    -- add / edit / del / undel / member+ / member-
  k         text,
  id        text,
  before    jsonb,
  after     jsonb
);
create index if not exists ledger_log_by_ledger on public.ledger_log (ledger_id, seq desc);

-- 我是谁：Google 登录的邮箱（小写）
create or replace function public.ledger_me() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- 能不能碰这本账。security definer：不然查 ledgers / ledger_members 时又会套上它们自己的 RLS，绕成死循环。
create or replace function public.ledger_ok(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ledgers l where l.id = lid and l.owner_id = auth.uid())
      or exists (select 1 from ledger_members m where m.ledger_id = lid and m.email = ledger_me());
$$;

create or replace function public.ledger_is_owner(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ledgers l where l.id = lid and l.owner_id = auth.uid());
$$;

-- 时间用数据库的钟，不用浏览器的：两台电脑差几分钟很正常，拿它排先后会乱。
-- 「谁加的」只在第一次写入时定下来，之后谁改都不变。
create or replace function public.ledger_items_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := ledger_me();
  if tg_op = 'INSERT' then
    new.created_by := ledger_me();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
drop trigger if exists ledger_items_touch on public.ledger_items;
create trigger ledger_items_touch before insert or update on public.ledger_items
  for each row execute function public.ledger_items_touch();

-- 历史记录。security definer：网页没有写 ledger_log 的权限，只有这个触发器能写。
-- 内容没变的重推（网页偶尔会把同一笔再推一次）不记。
create or replace function public.ledger_items_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text;
begin
  if tg_op = 'INSERT' then
    a := case when new.deleted then 'del' else 'add' end;
    insert into ledger_log (ledger_id, who, act, k, id, before, after)
    values (new.ledger_id, ledger_me(), a, new.k, new.id, null, new.data);
  elsif new.deleted is distinct from old.deleted or new.data is distinct from old.data then
    a := case when new.deleted and not old.deleted then 'del'
              when old.deleted and not new.deleted then 'undel'
              else 'edit' end;
    insert into ledger_log (ledger_id, who, act, k, id, before, after)
    values (new.ledger_id, ledger_me(), a, new.k, new.id, old.data, new.data);
  end if;
  return null;
end $$;
drop trigger if exists ledger_items_log on public.ledger_items;
create trigger ledger_items_log after insert or update on public.ledger_items
  for each row execute function public.ledger_items_log();

-- 拉人 / 踢人也记一笔
create or replace function public.ledger_members_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into ledger_log (ledger_id, who, act, id, after)
    values (new.ledger_id, ledger_me(), 'member+', new.email, jsonb_build_object('name', new.name));
  elsif tg_op = 'DELETE' then
    -- 整本账被删的时候（级联删成员）账本已经没了，不用记
    if exists (select 1 from ledgers where id = old.ledger_id) then
      insert into ledger_log (ledger_id, who, act, id, before)
      values (old.ledger_id, ledger_me(), 'member-', old.email, jsonb_build_object('name', old.name));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists ledger_members_log on public.ledger_members;
create trigger ledger_members_log after insert or delete on public.ledger_members
  for each row execute function public.ledger_members_log();

-- 成员邮箱一律存小写，免得大小写不同认不出
create or replace function public.ledger_members_lower() returns trigger
language plpgsql as $$ begin new.email := lower(trim(new.email)); return new; end $$;
drop trigger if exists ledger_members_lower on public.ledger_members;
create trigger ledger_members_lower before insert or update on public.ledger_members
  for each row execute function public.ledger_members_lower();

alter table public.ledgers        enable row level security;
alter table public.ledger_members enable row level security;
alter table public.ledger_items   enable row level security;
alter table public.ledger_log     enable row level security;

drop policy if exists ledgers_read   on public.ledgers;
drop policy if exists ledgers_new    on public.ledgers;
drop policy if exists ledgers_owner  on public.ledgers;
drop policy if exists ledgers_del    on public.ledgers;
-- 读：主人那一条直接按 owner_id 认，**不能只靠 ledger_ok()**。
-- 「开始共享」是 insert … returning（建完要拿回新账本的 id），返回那一行也得过 select 策略；
-- 而 ledger_ok() 是 stable 函数，看到的是这条语句开始之前的数据 —— 刚插进去的那本账它看不见，
-- 结果就是 new row violates row-level security policy for table "ledgers"（她第一次点「开始共享」撞上的）。
create policy ledgers_read  on public.ledgers for select using (owner_id = auth.uid() or ledger_ok(id));
create policy ledgers_new   on public.ledgers for insert with check (owner_id = auth.uid());
create policy ledgers_owner on public.ledgers for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy ledgers_del   on public.ledgers for delete using (owner_id = auth.uid());

drop policy if exists members_read on public.ledger_members;
drop policy if exists members_add  on public.ledger_members;
drop policy if exists members_edit on public.ledger_members;
drop policy if exists members_del  on public.ledger_members;
create policy members_read on public.ledger_members for select using (ledger_ok(ledger_id));
create policy members_add  on public.ledger_members for insert with check (ledger_is_owner(ledger_id));
create policy members_edit on public.ledger_members for update using (ledger_is_owner(ledger_id)) with check (ledger_is_owner(ledger_id));
create policy members_del  on public.ledger_members for delete using (ledger_is_owner(ledger_id));

-- 账目：读、加、改都行；没有 delete 策略 —— 删一律是打 deleted 标记，历史里看得到、找得回
drop policy if exists items_read on public.ledger_items;
drop policy if exists items_add  on public.ledger_items;
drop policy if exists items_edit on public.ledger_items;
create policy items_read on public.ledger_items for select using (ledger_ok(ledger_id));
create policy items_add  on public.ledger_items for insert with check (ledger_ok(ledger_id));
create policy items_edit on public.ledger_items for update using (ledger_ok(ledger_id)) with check (ledger_ok(ledger_id));

-- 历史：只能看
drop policy if exists log_read on public.ledger_log;
create policy log_read on public.ledger_log for select using (ledger_ok(ledger_id));
