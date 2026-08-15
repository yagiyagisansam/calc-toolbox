-- =============================================================
-- テスト用: pg_net / pg_cron の代わりになる作り物
--
-- 本番の Supabase では拡張が本物を用意する。テストの目的は
-- 「取り込みの判断が正しいか」なので、外へ出る部分は作り物で足りる。
-- むしろ本物だと外部へ出てしまうので、作り物でなければならない。
--
-- 時刻も差し替えられるようにしてある(set_now)。周回の切り替わりや
-- 取り直しの間隔を、実際に待たずに再現するため。
-- =============================================================

-- ---- 役割(Supabase では既にあるもの) ----
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

-- ---- 差し替えられる「いまの時刻」 ----
create table if not exists test_clock (at timestamptz);

create or replace function set_now(p_at text) returns void language sql as $$
  delete from test_clock;
  insert into test_clock values (p_at::timestamptz);
$$;

-- now() を上書きする。search_path の先頭に public が来るので、
-- weather-cache.sql の中の now() はこちらを見る。
create or replace function public.now() returns timestamptz
language sql stable as $$
  select coalesce((select at from test_clock limit 1), pg_catalog.now())
$$;

-- current_date は SQL の予約語なので同じ手が使えない。テストの中で
-- 日付をまたぐ場面は無いので、本物のままにしてある(取り直しの枠は
-- 場面ごとに reset_all で消している)。


-- ---- pg_net の代わり ----
create schema if not exists net;

create table if not exists net._http_response (
  id          bigint primary key,
  status_code int,
  content     text,
  error_msg   text,
  created     timestamptz default clock_timestamp()
);

create sequence if not exists net_request_seq;

-- 何をどの URL で頼んだかを残す(地点数の検算に使う)
create table if not exists net_request_log (
  id  bigint primary key,
  url text not null,
  at  timestamptz default clock_timestamp()
);

/*
 * 本物と同じく「投げて id を返すだけ」。応答は後から arrive() で足す。
 * ここで実際に外へ出ないことが重要(テストが上流を叩かないこと)。
 */
create or replace function net.http_get(
  url text,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare rid bigint;
begin
  rid := nextval('net_request_seq');
  insert into net_request_log (id, url) values (rid, url);
  return rid;
end;
$$;


-- ---- pg_cron の代わり ----
create schema if not exists cron;

create table if not exists cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text,
  command  text
);

create or replace function cron.schedule(p_name text, p_schedule text, p_command text)
returns bigint language plpgsql as $$
declare id bigint;
begin
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into id;
  return id;
end;
$$;

create or replace function cron.unschedule(p_name text)
returns boolean language sql as $$
  delete from cron.job where jobname = p_name; select true;
$$;


-- ---- 拡張の作成を素通りさせる ----
-- weather-cache.sql の先頭にある create extension は、この環境では実体が無い。
-- 上の作り物で代用しているので、何もしない命令に置き換える。
create or replace function public.noop_extension() returns void language sql as $$ select $$;
