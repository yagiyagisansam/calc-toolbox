-- =============================================================
-- 星見スポット: 天気予報のサーバー側キャッシュ
-- Supabase の SQL Editor に貼って1回だけ実行する(setup.sql の後)
--
-- なぜ必要か:
--   当初は訪問者のブラウザが直接 Open-Meteo へ全国552地点を問い合わせていた。
--   これだと地図を1回開くだけで無料枠(600回/分)をほぼ使い切り、
--   同時に複数人が使えない。実測でも、地図を開いた直後の詳細ページ取得が
--   429 で弾かれた。
--
--   そこで「全国の格子は誰が見ても同じ」という性質を使い、
--   こちらで定期的に取得して全員に配る。
--   上流への呼び出しは訪問者数に関係なく一定になる。
--   ブラウザは Open-Meteo に一切触れない。
--
-- 更新の頻度(2026-08-13 Hiroさん指示):
--   Open-Meteo の無料枠は1日10,000回。1回の更新で552地点ぶんを使うので、
--   1日に回せるのは最大18回。実際に見られるのは夜なので、そこへ厚く配る。
--     ・18時〜翌3時(日本時間)は毎時   … 10回
--     ・それ以外は3時間ごと(6/9/12/15時) …  4回
--   合わせて14回 = 7,728回/日 で、枠の約77%。手で何回か試しても余裕がある。
--   更新の間隔は最大でも3時間。1回の取得で30時間先まで持つので、
--   いつ見ても「今夜」は必ず含まれている。
--
--   ※ 格子を細かくする(地点数を増やす)ときは、
--     (地点数) × (1日の更新回数) ≦ 10,000 を必ず確かめること。
--
-- 仕組み:
--   pg_cron が pg_net で取得を要求し(stars_weather_request)、
--   その3分後に応答を取り込む(stars_weather_collect)。
--   pg_net は非同期なので、要求と取り込みを分けている。
--   取り込んだものは stars_weather_cache に1行だけ入り、匿名でも読める。
--
-- 出典表示(CC BY 4.0)はサイト側のフッターで行っている。
-- =============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ---- ① 格子の定義(唯一の出所) ----
-- サイト側はこの値をキャッシュの meta から読むので、ここだけを直せばよい。
-- 対象地域を広げるときは south/north/west/east を変える。
-- ただし地点数を増やすと上流の呼び出し数も増えるので、
--   (地点数) × (1日の更新回数) ≦ 10,000 に収まるか確認すること。
create or replace function public.stars_grid_def()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'south', 24, 'north', 46, 'west', 123, 'east', 146, 'step', 1,
    -- 何時間先まで持つか。更新が数回飛んでも「今夜」を賄えるだけの余裕を見ている。
    'hours', 30,
    -- 1回のURLが長くなりすぎないよう分割する数
    'parts', 2
  );
$$;


-- ---- ② 格子の地点(北→南、西→東の順に通し番号を振る) ----
create or replace function public.stars_grid_points(p_part int)
returns table (rn bigint, lat int, lon int)
language sql
stable
as $$
  with d as (select public.stars_grid_def() v),
  pts as (
    select row_number() over (order by la desc, lo asc) as rn, la as lat, lo as lon
    from d,
         generate_series((v->>'north')::int, (v->>'south')::int, -1) la,
         generate_series((v->>'west')::int, (v->>'east')::int, 1) lo
  ),
  n as (select count(*) c from pts, d)
  select p.rn, p.lat, p.lon
  from pts p, n, d
  -- 通し番号の連続した塊に分ける(順番を保ったまま後で連結できるように)
  where p.rn > (n.c * (p_part - 1)) / (v->>'parts')::int
    and p.rn <= (n.c * p_part) / (v->>'parts')::int;
$$;


-- ---- ③ キャッシュ本体 ----
create table if not exists public.stars_weather_cache (
  kind       text primary key,
  payload    jsonb not null,
  meta       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.stars_weather_cache enable row level security;

-- 中身は誰が見ても同じ公開データなので、匿名の読み取りだけ許可する
drop policy if exists stars_weather_cache_read on public.stars_weather_cache;
create policy stars_weather_cache_read on public.stars_weather_cache
  for select to anon, authenticated using (true);

revoke all on table public.stars_weather_cache from anon, authenticated;
grant select on table public.stars_weather_cache to anon, authenticated;


-- ---- ④ 取得中の要求を覚えておく場所 ----
create table if not exists public.stars_weather_pending (
  kind         text not null,
  part         int not null,
  request_id   bigint not null,
  requested_at timestamptz not null default now(),
  primary key (kind, part)
);

alter table public.stars_weather_pending enable row level security;
revoke all on table public.stars_weather_pending from anon, authenticated;


-- ---- ⑤ 取得を要求する ----
create or replace function public.stars_weather_request()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d      jsonb := public.stars_grid_def();
  parts  int   := (d->>'parts')::int;
  i      int;
  lats   text;
  lons   text;
  url    text;
  rid    bigint;
begin
  for i in 1..parts loop
    select string_agg(lat::text, ',' order by rn), string_agg(lon::text, ',' order by rn)
      into lats, lons
      from public.stars_grid_points(i);

    url := 'https://api.open-meteo.com/v1/forecast'
        || '?latitude=' || lats
        || '&longitude=' || lons
        || '&hourly=cloud_cover,precipitation_probability,visibility,relative_humidity_2m'
        || '&forecast_hours=' || (d->>'hours')
        || '&timeformat=unixtime&timezone=GMT';

    select net.http_get(url, timeout_milliseconds => 60000) into rid;

    insert into public.stars_weather_pending (kind, part, request_id, requested_at)
    values ('grid', i, rid, now())
    on conflict (kind, part)
      do update set request_id = excluded.request_id, requested_at = now();
  end loop;
  return parts;
end;
$$;

revoke all on function public.stars_weather_request() from public, anon, authenticated;


-- ---- ⑥ 応答を取り込む ----
-- 全部そろったときだけ入れ替える(途中の状態を見せないため)。
-- 取り込めなければ 0 を返し、前回のキャッシュをそのまま残す。
create or replace function public.stars_weather_collect()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d       jsonb := public.stars_grid_def();
  parts   int   := (d->>'parts')::int;
  r       record;
  body    jsonb;
  times   jsonb;
  cloud   jsonb := '[]'::jsonb;
  precip  jsonb := '[]'::jsonb;
  vis     jsonb := '[]'::jsonb;
  humid   jsonb := '[]'::jsonb;
  got     int   := 0;
begin
  for r in
    select * from public.stars_weather_pending where kind = 'grid' order by part
  loop
    select content::jsonb into body
    from net._http_response
    where id = r.request_id and status_code = 200;

    -- まだ届いていない・失敗した場合は、前回のキャッシュを保ったまま諦める
    if body is null or jsonb_typeof(body) <> 'array' then
      return 0;
    end if;

    if times is null then
      times := body->0->'hourly'->'time';
    end if;

    cloud  := cloud  || (select jsonb_agg(e->'hourly'->'cloud_cover' order by o)
                         from jsonb_array_elements(body) with ordinality t(e, o));
    precip := precip || (select jsonb_agg(e->'hourly'->'precipitation_probability' order by o)
                         from jsonb_array_elements(body) with ordinality t(e, o));
    vis    := vis    || (select jsonb_agg(e->'hourly'->'visibility' order by o)
                         from jsonb_array_elements(body) with ordinality t(e, o));
    humid  := humid  || (select jsonb_agg(e->'hourly'->'relative_humidity_2m' order by o)
                         from jsonb_array_elements(body) with ordinality t(e, o));
    got := got + 1;
  end loop;

  if got <> parts or times is null then
    return 0;
  end if;

  insert into public.stars_weather_cache (kind, payload, meta, updated_at)
  values (
    'grid',
    jsonb_build_object('times', times, 'cloud', cloud, 'precip', precip,
                       'visibility', vis, 'humidity', humid),
    d || jsonb_build_object('points', jsonb_array_length(cloud)),
    now()
  )
  on conflict (kind) do update
    set payload = excluded.payload, meta = excluded.meta, updated_at = now();

  return got;
end;
$$;

revoke all on function public.stars_weather_collect() from public, anon, authenticated;


-- ---- ⑦ 定期実行 ----
-- pg_cron の時刻は UTC。日本時間 = UTC + 9時間。
--   UTC 9〜18時          = 日本時間 18時〜翌3時(毎時。星を見る時間帯)
--   UTC 21, 0, 3, 6時    = 日本時間 6, 9, 12, 15時(3時間ごと)
-- 要求を出し、その3分後に取り込む。
select cron.unschedule('stars-weather-request')
  where exists (select 1 from cron.job where jobname = 'stars-weather-request');
select cron.unschedule('stars-weather-collect')
  where exists (select 1 from cron.job where jobname = 'stars-weather-collect');

select cron.schedule('stars-weather-request', '0 0,3,6,9,10,11,12,13,14,15,16,17,18,21 * * *',
  $$select public.stars_weather_request();$$);
select cron.schedule('stars-weather-collect', '3 0,3,6,9,10,11,12,13,14,15,16,17,18,21 * * *',
  $$select public.stars_weather_collect();$$);


-- ---- ⑧ 今すぐ1回取得する(次の定期実行を待たないため) ----
select public.stars_weather_request();
