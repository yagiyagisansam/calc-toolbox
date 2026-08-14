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
--   更新の間隔は最大でも3時間。1回の取得で78時間先まで持つので、
--   いつ見ても「今夜」に加えて明日・明後日の夜まで含まれている。
--   (時間数を増やしても呼び出し回数は変わらない。下の stars_grid_def を参照)
--
--   ※ 格子を細かくする(地点数を増やす)ときは、
--     (地点数) × (1日の更新回数) ≦ 10,000 を必ず確かめること。
--
-- 仕組み:
--   pg_cron が pg_net で取得を要求し(stars_weather_request)、
--   そのあと応答を取り込む(stars_weather_collect)。
--   pg_net は非同期なので、要求と取り込みを分けている。
--   取り込んだものは stars_weather_cache に1行だけ入り、匿名でも読める。
--
--   要求は6つに分け、cron で1分ずつずらして投げる。まとめて投げると上流の
--   「600回/分」に当たって全部が弾かれるため(下の parts を参照)。
--   0〜5分で投げ、8分に取り込む。
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
    -- 何時間先まで持つか。
    -- 「今夜」だけでなく明日・明後日の夜まで選べるようにするため78時間。
    -- 星見は前もって日を決める行為なので、今夜しか見られないと計画に使えない
    -- (レビューで4名が指摘)。
    -- 重要: Open-Meteo の呼び出し回数は「地点数」で数えられ、時間数では増えない。
    -- したがってここを伸ばしても上流への負荷と無料枠の消費は変わらない。
    -- 増えるのは配信量だけ(gzip で約74KB → 約190KB)。
    'hours', 78,
    -- 分割数。
    -- 上流の制限は「1分あたり600地点」。2分割(276地点ずつ)を同時に投げると
    -- 一瞬で552地点になり、その山で 503 The service is overloaded / 429 を返された
    -- (2026-08-14 実際に丸1日更新が止まった)。
    -- 6分割して1分ずつずらして投げると、1分あたり92地点に収まる。
    'parts', 6
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


-- ---- ④-2 直近の取り込み結果 ----
-- 取り込みは「失敗しても0を返して前回を残す」ので、cron の記録は succeeded になる。
-- それだと止まっていることに気づけないため、結果をここに1行だけ残す。
create table if not exists public.stars_weather_status (
  kind   text primary key,
  ok     boolean not null,
  detail text,
  at     timestamptz not null default now()
);

alter table public.stars_weather_status enable row level security;
revoke all on table public.stars_weather_status from anon, authenticated;


-- ---- ⑤ 取得を要求する(1回につき1分割ぶん) ----
-- 引数で分割の番号を受け取り、その1つだけを投げてすぐ返る。
--
-- なぜ関数の中で待たないか:
--   全分割を1つの関数の中で pg_sleep を挟みながら投げると、関数が
--   100秒ほど返ってこない。cron は耐えるが、SQL エディタから手で叩くと
--   接続が先に切れて Load failed になり、動作確認ができない
--   (2026-08-14 実際に踏んだ)。
--   間隔は cron 側で開ける ── 分割ごとに1分ずらして登録する(⑦)。
create or replace function public.stars_weather_request(p_part int, p_only_if_failed boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  d      jsonb := public.stars_grid_def();
  parts  int   := (d->>'parts')::int;
  lats   text;
  lons   text;
  url    text;
  rid    bigint;
begin
  if p_part < 1 or p_part > parts then
    raise exception '分割の番号は 1〜% です(渡された値: %)', parts, p_part;
  end if;

  -- 取り直し用。すでに200が取れている分割は投げ直さない(枠を無駄にしないため)
  if p_only_if_failed and exists (
    select 1
    from public.stars_weather_pending p
    join net._http_response x on x.id = p.request_id
    where p.kind = 'grid' and p.part = p_part and x.status_code = 200
  ) then
    return null;
  end if;

  -- 分割数を減らしたときに取り残しが出ないよう、範囲外の行は消しておく
  delete from public.stars_weather_pending where kind = 'grid' and part > parts;

  select string_agg(lat::text, ',' order by rn), string_agg(lon::text, ',' order by rn)
    into lats, lons
    from public.stars_grid_points(p_part);

  url := 'https://api.open-meteo.com/v1/forecast'
      || '?latitude=' || lats
      || '&longitude=' || lons
      || '&hourly=cloud_cover,precipitation_probability,visibility,relative_humidity_2m'
      || '&forecast_hours=' || (d->>'hours')
      || '&timeformat=unixtime&timezone=GMT';

  select net.http_get(url, timeout_milliseconds => 60000) into rid;

  insert into public.stars_weather_pending (kind, part, request_id, requested_at)
  values ('grid', p_part, rid, now())
  on conflict (kind, part)
    do update set request_id = excluded.request_id, requested_at = now();

  return rid;
end;
$$;

revoke all on function public.stars_weather_request(int, boolean) from public, anon, authenticated;

-- 旧版(引数なしで全分割をまとめて投げる)は、1分あたりの上限に当たるので捨てる
drop function if exists public.stars_weather_request();
drop function if exists public.stars_weather_request(int);


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
  -- 分割数を変えたときに古い行が残っていても数が合うよう、範囲を絞る
  for r in
    select * from public.stars_weather_pending
    where kind = 'grid' and part between 1 and parts
    order by part
  loop
    select content::jsonb into body
    from net._http_response
    where id = r.request_id and status_code = 200;

    -- まだ届いていない・失敗した場合は、前回のキャッシュを保ったまま諦める。
    -- ただし理由は必ず残す。ここを黙って0で返していたため、cron は succeeded、
    -- キャッシュは古いまま、という気づきにくい壊れ方をした(2026-08-14)。
    if body is null or jsonb_typeof(body) <> 'array' then
      insert into public.stars_weather_status (kind, ok, detail, at)
      values (
        'grid',
        false,
        'part ' || r.part || ': ' || coalesce(
          (select coalesce(x.error_msg, x.status_code::text || ' ' || left(x.content, 120))
             from net._http_response x where x.id = r.request_id),
          '応答なし'),
        now()
      )
      on conflict (kind) do update
        set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
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

  insert into public.stars_weather_status (kind, ok, detail, at)
  values ('grid', true, got || '件すべて取り込み', now())
  on conflict (kind) do update
    set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

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
--
-- 分割ごとに1分ずつずらして投げる。まとめて投げると上流の
-- 「600回/分」に当たって全部が弾かれるため(⑤の説明を参照)。
--   0分 → 分割1、1分 → 分割2 … 5分 → 分割6、8分 → 取り込み
do $do$
declare
  hours text := '0,3,6,9,10,11,12,13,14,15,16,17,18,21';
  parts int  := (public.stars_grid_def()->>'parts')::int;
  -- 毎時0分は世界中の定期実行が集中して上流が混む。実際 12:00 の要求は
  -- 503 The service is overloaded で弾かれ、その40分後に同じ要求が通った。
  -- そこで0分を避けて7分から投げる。
  first int := 7;
  i     int;
  name  text;
begin
  -- 以前の登録(分割なし版・古い分割数ぶん)をすべて片づける
  for name in
    select jobname from cron.job where jobname like 'stars-weather%'
  loop
    perform cron.unschedule(name);
  end loop;

  -- 1回目: 7分から1分ずつずらして全分割を投げる
  for i in 1..parts loop
    perform cron.schedule(
      'stars-weather-request-' || i,
      (first + i - 1) || ' ' || hours || ' * * *',
      format('select public.stars_weather_request(%s);', i)
    );
  end loop;

  -- 投げ終えた3分後に取り込む
  perform cron.schedule(
    'stars-weather-collect',
    (first + parts + 2) || ' ' || hours || ' * * *',
    'select public.stars_weather_collect();'
  );

  /*
   * 2回目(取り直し)。
   * 上流が一時的に混んでいると1つでも欠けて取り込みが丸ごと失敗し、
   * 次の定期実行(最大3時間後)まで古いままになる。同じ時間帯のうちに
   * もう一度だけ、失敗した分割にかぎって投げ直す。
   * すでに200が取れている分割は投げないので、枠はほとんど増えない。
   */
  for i in 1..parts loop
    perform cron.schedule(
      'stars-weather-retry-' || i,
      (first + parts + 5 + i - 1) || ' ' || hours || ' * * *',
      format('select public.stars_weather_request(%s, true);', i)
    );
  end loop;

  perform cron.schedule(
    'stars-weather-collect-2',
    (first + 2 * parts + 7) || ' ' || hours || ' * * *',
    'select public.stars_weather_collect();'
  );
end;
$do$;


-- ---- ⑧ 今すぐ1回ぶんだけ試す ----
-- 全分割をここで投げると1分あたりの上限に当たるので、1つだけにしておく。
-- 残りは次の定期実行で揃う。
select public.stars_weather_request(1) as 要求id;
