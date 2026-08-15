-- =============================================================
-- 天気キャッシュ: 新旧の周回が混ざる不具合の修正
--
-- これは scripts/stars/weather-cache.sql の変更部分だけを切り出したもの。
-- 全部を貼り直さなくて済むようにしてある(中身は正本と同一)。
-- Supabase の SQL Editor に貼って1回実行する。何度実行しても壊れない。
--
-- 何が直るか:
--   これまで「周回」を全分割の requested_at の最大値から決めていたため、
--   分割1〜4が新しく5〜6が前の周回のままでも、すべてが200なら
--   取り込みが通っていた。時刻の並びは分割1のものを使うので、
--   3時間前の値が新しい時刻の欄に並ぶ。実際に552地点中270地点が
--   3時間前という状態になり、画面には何の異常も出なかった。
--
--   投げるときに周回を決めて記録し、全分割の周回が一致し、
--   中身の検証を全部通ったときだけ公開するようにする。
--
-- 実行後の確認(このファイルの最後にある select がそれを出す):
--   周回が「毎時ちょうど」になっていれば新しい版で動いている。
-- =============================================================

-- ---- ④ 取得中の要求を覚えておく場所 ----
--
-- cycle_at は「どの周回の要求か」を表す。
--
-- なぜ要るか(2026-08-14 に実際に起きた壊れ方):
--   以前は周回の識別子を「全分割の requested_at の最大値」としていた。
--   そのため分割1〜4だけが新しく、分割5〜6が前の周回のまま残っていても、
--   すべてが200でありさえすれば取り込みが通ってしまった。
--   時刻の並びは分割1のものを使うので、3時間前のデータが新しい時刻の欄に
--   並ぶことになる。実際に 282地点が新しく 270地点が3時間前、という
--   キャッシュが出来上がった(東海以西が古いまま)。画面上は何の異常も出ない。
--
--   周回を「投げた時刻の最大値」から決めるのが誤りだった。
--   投げるときに周回を決めて記録し、全分割の周回が一致したときだけ公開する。
create table if not exists public.stars_weather_pending (
  kind         text not null,
  part         int not null,
  request_id   bigint not null,
  requested_at timestamptz not null default now(),
  cycle_at     timestamptz not null,
  primary key (kind, part)
);

-- 既に動いている環境向け。cycle_at が無い時期の行は、投げた時刻の時で埋める。
alter table public.stars_weather_pending add column if not exists cycle_at timestamptz;
update public.stars_weather_pending
   set cycle_at = date_trunc('hour', requested_at)
 where cycle_at is null;
alter table public.stars_weather_pending alter column cycle_at set not null;

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


-- ---- ④-3 いま追いかけている周回 ----
-- pending にある中でいちばん新しい周回。これが「揃えようとしている周回」。
create or replace function public.stars_weather_cycle()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(cycle_at) from public.stars_weather_pending where kind = 'grid'
$$;

revoke all on function public.stars_weather_cycle() from public, anon, authenticated;


-- ---- ④-4 その分割が「遅れている」か ----
-- 遅れているのは次のいずれか:
--   ・前の周回のまま置き去りになっている
--   ・応答が届いたが200でない
--   ・投げてから3分たっても応答が無い
--
-- 45分という時間の物差しは使わない。周回で見れば「前の周回のもの」が
-- 一目で分かるし、分割を1つだけ投げ直したときに残りが置き去りになる、
-- という以前の不具合も起きない。
--
-- 3分の猶予が要るのは、応答が届く前に「失敗した」と決めつけて
-- 投げ直すのを防ぐため。上流への呼び出しの上限を無駄に食う。
create or replace function public.stars_weather_part_stale(p_part int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.cycle_at < public.stars_weather_cycle()
            or (x.id is not null and coalesce(x.status_code, 0) <> 200)
            or (x.id is null and p.requested_at < now() - interval '3 minutes')
     from public.stars_weather_pending p
     left join net._http_response x on x.id = p.request_id
     where p.kind = 'grid' and p.part = p_part),
    true) -- まだ一度も投げていない分割も「遅れている」扱い
$$;

revoke all on function public.stars_weather_part_stale(int) from public, anon, authenticated;


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
  d       jsonb := public.stars_grid_def();
  parts   int   := (d->>'parts')::int;
  v_cycle timestamptz;
  lats    text;
  lons    text;
  url     text;
  rid     bigint;
begin
  if p_part < 1 or p_part > parts then
    raise exception '分割の番号は 1〜% です(渡された値: %)', parts, p_part;
  end if;

  -- 取り直し用。遅れている分割だけを投げ直す(判定は ④-4 に集約)。
  if p_only_if_failed and not public.stars_weather_part_stale(p_part) then
    return null;
  end if;

  /*
   * この要求がどの周回のものかを決める。
   *
   * 定例(p_only_if_failed = false):
   *   その時の「時」を周回とする。定例は7分〜12分に1分ずつずらして投げるので、
   *   6分割すべてが同じ時に入り、同じ周回になる。
   *
   * 取り直し(p_only_if_failed = true):
   *   新しい周回を作らず、いま追いかけている周回に入れる。
   *   ここで新しい周回にしてしまうと、投げ直した分割だけが新しい周回になり、
   *   いつまでも揃わない。
   *   追いかける相手が無い(pending が空)なら、定例と同じ扱いにする。
   */
  if p_only_if_failed then
    v_cycle := coalesce(public.stars_weather_cycle(), date_trunc('hour', now()));
  else
    v_cycle := date_trunc('hour', now());
  end if;

  delete from public.stars_weather_pending where kind = 'grid' and part > parts;

  select string_agg(lat::text, ',' order by rn), string_agg(lon::text, ',' order by rn)
    into lats, lons
    from public.stars_grid_points(p_part);

  /*
   * models= は付けない。Open-Meteo の既定である Best Match に任せる。
   *
   * サイト側では「日本国内は気象庁モデル」と書いていたが、この URL は
   * モデルを指定していないので、それは事実ではなかった(独立検証で指摘)。
   * 直し方は2つあり、こちらを選んだ:
   *   ・models=jma... と書いて文言に合わせる
   *   ・Best Match のままにして文言を直す ← これ
   * モデルを1つに固定すると、予報できる時間の長さ・使える要素・
   * 上流が落ちたときの代替が、そのモデルの都合に縛られる。
   * 78時間先まで4指標を安定して得るほうが、この用途では大事。
   * 文言は stars/about.html などで「Best Match」と書き直してある。
   */
  url := 'https://api.open-meteo.com/v1/forecast'
      || '?latitude=' || lats
      || '&longitude=' || lons
      || '&hourly=cloud_cover,precipitation_probability,visibility,relative_humidity_2m'
      || '&forecast_hours=' || (d->>'hours')
      || '&timeformat=unixtime&timezone=GMT';

  select net.http_get(url, timeout_milliseconds => 60000) into rid;

  insert into public.stars_weather_pending (kind, part, request_id, requested_at, cycle_at)
  values ('grid', p_part, rid, now(), v_cycle)
  on conflict (kind, part)
    do update set request_id = excluded.request_id,
                  requested_at = now(),
                  cycle_at = excluded.cycle_at;

  return rid;
end;
$$;

revoke all on function public.stars_weather_request(int, boolean) from public, anon, authenticated;

-- 旧版(引数なしで全分割をまとめて投げる)は、1分あたりの上限に当たるので捨てる
drop function if exists public.stars_weather_request();
drop function if exists public.stars_weather_request(int);


-- ---- ⑥-0 応答の中身が使えるかを確かめる ----
--
-- 上流が HTTP 200 を返しても、中身が期待どおりとは限らない。
-- 200 のままエラーの JSON が返ることもあるし、一部の指標だけ欠けることもある。
-- そのまま入れると、雲量が空配列になり、サイト側では「雲0%＝快晴」に化ける。
-- 「取れなかった」より「快晴だと言い切る」ほうが害が大きいので、
-- 少しでも形が違えば取り込まない。前回のキャッシュを残すほうが安全。
-- coalesce で必ず true/false にすることが重要。
-- 指標そのものが無い応答では p_series は SQL の NULL になり、
-- jsonb_typeof(NULL) も NULL、比較結果も NULL になる。
-- そのまま `not 検証(...)` で数えると NULL は「偽」でも「真」でもないため
-- 一件も引っかからず、指標が丸ごと欠けた応答が素通りした
-- (この関数を書いた直後、自分のテストで実際に通り抜けた)。
create or replace function public.stars_weather_valid_series(
  p_series jsonb, p_len int, p_min numeric, p_max numeric)
returns boolean
language sql
immutable
as $$
  select coalesce(
    jsonb_typeof(p_series) = 'array'
    and jsonb_array_length(p_series) = p_len
    and not exists (
      select 1
      from jsonb_array_elements(p_series) v
      where jsonb_typeof(v) not in ('number', 'null')
         or (jsonb_typeof(v) = 'number'
             and ((v #>> '{}')::numeric < p_min or (v #>> '{}')::numeric > p_max))
    ),
    false)
$$;

revoke all on function public.stars_weather_valid_series(jsonb, int, numeric, numeric)
  from public, anon, authenticated;


-- ---- ⑥ 応答を取り込む ----
--
-- 公開するのは、次を全部満たしたときだけ。1つでも欠ければ前回のキャッシュを残す。
--   ・分割 1〜parts が同じ周回で1件ずつ揃っている
--   ・全分割の応答が HTTP 200
--   ・全分割の中身が配列として読める(壊れた JSON を弾く)
--   ・各分割の地点数が、その分割で頼んだ地点数と一致する
--   ・全分割の時刻の並びが完全に一致する
--   ・4指標がすべて配列で、長さが時刻の並びと一致し、値が妥当な範囲に収まる
--   ・その周回をまだ公開していない
--
-- 取り込めない理由は必ず stars_weather_status に残す。
-- 黙って0を返していたため、cron は succeeded・キャッシュは13時間古いまま、
-- という気づきにくい壊れ方をした(2026-08-14)。
create or replace function public.stars_weather_collect()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d        jsonb := public.stars_grid_def();
  parts    int   := (d->>'parts')::int;
  v_cycle  timestamptz;
  n_parts  int;
  r        record;
  raw      text;
  body     jsonb;
  times    jsonb;
  n_times  int;
  want_pts int;
  bad      int;
  why      text;
  cloud    jsonb := '[]'::jsonb;
  precip   jsonb := '[]'::jsonb;
  vis      jsonb := '[]'::jsonb;
  humid    jsonb := '[]'::jsonb;
  got      int   := 0;

  -- 取り込めなかった理由。null のままなら成功。
  fail     text;
begin
  /*
   * 取り込みは5分おきに走るうえ、手でも叩ける。2つが同時に走ると
   * 同じ周回を2回公開しかねないので、ここで直列化する。
   * 待った側は、先に走ったほうが公開を終えているので -1 で返る。
   */
  perform pg_advisory_xact_lock(hashtext('stars_weather_collect'));

  v_cycle := public.stars_weather_cycle();
  if v_cycle is null then
    return 0; -- まだ一度も投げていない
  end if;

  -- この周回はもう公開済み。何度呼ばれても書き直さない
  -- (同じ内容で updated_at だけ進むのを防ぐ)。
  if exists (
    select 1 from public.stars_weather_cache
    where kind = 'grid' and meta->>'cycle' = v_cycle::text
  ) then
    return -1;
  end if;

  -- 分割 1〜parts が、この周回で1件ずつ揃っているか。
  -- 主キーが (kind, part) なので重複は起こらない。足りない場合だけを見る。
  select count(distinct part) into n_parts
  from public.stars_weather_pending
  where kind = 'grid' and cycle_at = v_cycle and part between 1 and parts;

  if n_parts <> parts then
    -- まだ揃っていないだけ。失敗ではないので status は汚さない
    -- (揃うまでの数分間、画面に「失敗」と出てしまうため)。
    return 0;
  end if;

  for r in
    select * from public.stars_weather_pending
    where kind = 'grid' and cycle_at = v_cycle and part between 1 and parts
    order by part
  loop
    -- 応答そのもの
    select x.content into raw
    from net._http_response x
    where x.id = r.request_id and x.status_code = 200;

    if raw is null then
      fail := 'part ' || r.part || ': ' || coalesce(
        (select coalesce(x.error_msg, x.status_code::text)
           from net._http_response x where x.id = r.request_id),
        '応答なし');
      exit;
    end if;

    -- 壊れた JSON。text::jsonb は例外を投げるので、必ず受け止める。
    begin
      body := raw::jsonb;
    exception when others then
      body := null;
    end;

    if body is null or jsonb_typeof(body) <> 'array' then
      fail := 'part ' || r.part || ': 応答が配列として読めません';
      exit;
    end if;

    -- 頼んだ地点数と返ってきた地点数が合うか
    select count(*) into want_pts from public.stars_grid_points(r.part);
    if jsonb_array_length(body) <> want_pts then
      fail := 'part ' || r.part || ': 地点数が ' || jsonb_array_length(body)
           || ' (期待 ' || want_pts || ')';
      exit;
    end if;

    -- 時刻の並び。最初の分割のものを基準にし、以降は完全一致を求める。
    if times is null then
      times := body->0->'hourly'->'time';
      if jsonb_typeof(times) <> 'array' or jsonb_array_length(times) = 0 then
        fail := 'part ' || r.part || ': 時刻の並びがありません';
        exit;
      end if;
      n_times := jsonb_array_length(times);
    end if;

    /*
     * 4指標の形と、時刻の並びが分割をまたいで一致するか。地点ごとに見る
     * (1地点でも形が違えば取り込まない)。
     * どこがおかしいのかを名指しで残す ── 原因が分からないまま
     * 「取り込めません」とだけ出ても、直しようがないため。
     */
    select count(*) filter (where not t_ok)
         + count(*) filter (where not c_ok)
         + count(*) filter (where not p_ok)
         + count(*) filter (where not v_ok)
         + count(*) filter (where not h_ok),
         string_agg(distinct w, '・')
      into bad, why
    from (
      select
        (e->'hourly'->'time' is not distinct from times) as t_ok,
        public.stars_weather_valid_series(e->'hourly'->'cloud_cover', n_times, 0, 100) as c_ok,
        public.stars_weather_valid_series(e->'hourly'->'precipitation_probability', n_times, 0, 100) as p_ok,
        public.stars_weather_valid_series(e->'hourly'->'visibility', n_times, 0, 1000000) as v_ok,
        public.stars_weather_valid_series(e->'hourly'->'relative_humidity_2m', n_times, 0, 100) as h_ok
      from jsonb_array_elements(body) e
    ) s,
    lateral (
      select w from (values
        ('時刻の並び', s.t_ok),
        ('雲量', s.c_ok),
        ('降水確率', s.p_ok),
        ('視程', s.v_ok),
        ('湿度', s.h_ok)
      ) v(w, good) where not v.good
    ) bad_names(w);

    if coalesce(bad, 0) > 0 then
      fail := 'part ' || r.part || ': ' || coalesce(why, '中身')
           || 'が期待どおりではありません'
           || '(欠落・長さ違い・値の範囲外・分割間の不一致のいずれか)';
      exit;
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

  if fail is null and got <> parts then
    fail := '揃ったのは ' || got || ' / ' || parts || ' 分割';
  end if;

  if fail is not null then
    insert into public.stars_weather_status (kind, ok, detail, at)
    values ('grid', false, left(fail, 300), now())
    on conflict (kind) do update
      set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
    return 0;
  end if;

  /*
   * ここまでで得たのは「取りに行った地点」ぶんだけ。
   * サイト側は552地点ぶんの長方形の格子を前提にしているので、
   * 落とした地点に最も近い取得地点の値を複製して元の形に戻す。
   * こうするとサイト側の実装は一切変えなくてよい。
   */
  cloud  := (select jsonb_agg(cloud ->(c.src_pos - 1) order by c.rn) from public.stars_grid_cells c);
  precip := (select jsonb_agg(precip->(c.src_pos - 1) order by c.rn) from public.stars_grid_cells c);
  vis    := (select jsonb_agg(vis   ->(c.src_pos - 1) order by c.rn) from public.stars_grid_cells c);
  humid  := (select jsonb_agg(humid ->(c.src_pos - 1) order by c.rn) from public.stars_grid_cells c);

  insert into public.stars_weather_status (kind, ok, detail, at)
  values ('grid', true, got || '分割すべて取り込み(周回 ' || v_cycle::text || ')', now())
  on conflict (kind) do update
    set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

  insert into public.stars_weather_cache (kind, payload, meta, updated_at)
  values (
    'grid',
    jsonb_build_object('times', times, 'cloud', cloud, 'precip', precip,
                       'visibility', vis, 'humidity', humid),
    d || jsonb_build_object('points', jsonb_array_length(cloud), 'cycle', v_cycle::text),
    now()
  )
  on conflict (kind) do update
    set payload = excluded.payload, meta = excluded.meta, updated_at = now();

  return got;
end;
$$;

revoke all on function public.stars_weather_collect() from public, anon, authenticated;




-- ---- 確認 ----
-- cycle_at が入ったか
select
  count(*) filter (where cycle_at is not null) as 周回が入った行,
  count(*)                                     as 全部の行
from public.stars_weather_pending;

-- いま追いかけている周回(毎時ちょうどになっていれば新しい版)
select public.stars_weather_cycle() as いまの周回;

-- 直近の取り込み結果
select ok as 成功, detail as 内容, at as 時刻
from public.stars_weather_status where kind = 'grid';
