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
-- 更新の頻度(2026-08-13 Hiroさん指示。減らさないこと):
--     ・18時〜翌3時(日本時間)は毎時   … 10回
--     ・それ以外は3時間ごと(6/9/12/15時) …  4回
--   合わせて14回/日。
--
--   1回の更新で取りに行くのは325地点(全552地点のうち陸に関わるぶんだけ。①-2 を参照)。
--   14回 × 325地点 = 4,550回/日 で、無料枠 10,000回/日 の約46%。
--   残りは取り直し(⑥-2)に使う。海上を落とす前は7,728回/日で余裕が無かった。
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
--
--   上流は無料の best-effort なので、いつでも 503 を返しうる。時刻をずらすだけでは
--   確率が下がるだけで保証にならない。そこで「揃うまで自動で追いかける」形にした:
--     ・決められた時刻に全分割を投げる(7〜12分)
--     ・揃っていない分割を2分おきに1つずつ投げ直す(常時)
--     ・5分おきに取り込みを試し、全分割が揃った時点で反映する(常時)
--   全部が200なら投げ直しは何もしないので、常時動かしても枠は消費しない。
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
    -- 6分割して1分ずつずらして投げると、1分あたり約54地点に収まる。
    'parts', 6
  );
$$;


revoke all on function public.stars_grid_def() from public, anon, authenticated;


-- ---- ①-2 上流へ取りに行く地点の表 ----
-- 全552地点のうち、どれを取りに行くかを1行の並びで受け取って組み立てる。
-- 並びは scripts/stars/land_grid.mjs --mask が作る
-- (北→南・西→東の順、1=取りに行く。陸から1度以内の地点だけが1になっている)。
--
-- 落とすのは外洋だけで、地図では海に色を塗っていないので表示には使われない。
-- 陸の描画が落とす前と1つも変わらないことは、海岸線の全頂点について
-- 「囲む4点がすべて残っている」ことを land_grid.mjs で検査済み。
create table if not exists public.stars_grid_cells (
  rn      int primary key,
  lat     int not null,
  lon     int not null,
  fetched boolean not null,
  src_pos int not null   -- 取得した配列の何番目の値を使うか(1始まり)
);

alter table public.stars_grid_cells enable row level security;
revoke all on table public.stars_grid_cells from anon, authenticated;

create or replace function public.stars_grid_build(p_mask text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d     jsonb := public.stars_grid_def();
  total int;
begin
  select count(*) into total
  from generate_series((d->>'north')::int, (d->>'south')::int, -1) la,
       generate_series((d->>'west')::int, (d->>'east')::int, 1) lo;

  if length(p_mask) <> total then
    raise exception '並びの長さが合いません(渡された %, 必要 %)', length(p_mask), total;
  end if;

  delete from public.stars_grid_cells;

  -- まず地点そのものを入れる(src_pos は後で埋める)
  insert into public.stars_grid_cells (rn, lat, lon, fetched, src_pos)
  select rn, lat, lon, substr(p_mask, rn::int, 1) = '1', 0
  from (
    select row_number() over (order by la desc, lo asc) as rn, la as lat, lo as lon
    from generate_series((d->>'north')::int, (d->>'south')::int, -1) la,
         generate_series((d->>'west')::int, (d->>'east')::int, 1) lo
  ) t;

  -- 取りに行く地点に、取得する配列の中での位置を振る
  with pos as (
    select rn, row_number() over (order by rn) as p
    from public.stars_grid_cells where fetched
  )
  update public.stars_grid_cells c set src_pos = pos.p
  from pos where pos.rn = c.rn;

  -- 落とした地点には、最も近い取得地点の位置を割り当てる
  with nearest as (
    select c.rn,
           (select f.src_pos
            from public.stars_grid_cells f
            where f.fetched
            order by (f.lat - c.lat) ^ 2 + (f.lon - c.lon) ^ 2, f.rn
            limit 1) as p
    from public.stars_grid_cells c
    where not c.fetched
  )
  update public.stars_grid_cells c set src_pos = nearest.p
  from nearest where nearest.rn = c.rn;

  return (select count(*) from public.stars_grid_cells where fetched);
end;
$$;

revoke all on function public.stars_grid_build(text) from public, anon, authenticated;


-- ---- ② 上流へ取りに行く地点 ----
-- 全552地点のうち、陸から1度以内にある地点だけを取りに行く。
-- 残りは外洋で、地図では海に色を塗っていないので表示に使われない。
-- どの地点を取りに行くかは stars_grid_cells に入っている
-- (scripts/stars/land_grid.mjs が生成。陸の描画は落とす前と1つも変わらないことを
--  海岸線の全頂点で検査済み)。
create or replace function public.stars_grid_points(p_part int)
returns table (rn bigint, lat int, lon int)
language sql
stable
as $$
  with f as (
    -- 取りに行く地点だけを、通し番号の順に並べ直す
    select row_number() over (order by c.rn) as pos, c.lat, c.lon
    from public.stars_grid_cells c
    where c.fetched
  ),
  n as (select count(*) c from f),
  d as (select (public.stars_grid_def()->>'parts')::int parts)
  select f.pos, f.lat, f.lon
  from f, n, d
  -- 通し番号の連続した塊に分ける(順番を保ったまま後で連結できるように)
  where f.pos > (n.c * (p_part - 1)) / d.parts
    and f.pos <= (n.c * p_part) / d.parts;
$$;


revoke all on function public.stars_grid_points(int) from public, anon, authenticated;


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


-- ---- ⑥-1 取り直しに使ってよい枠(1日ぶん) ----
-- 追いかけ続けると、上流が長時間落ちているときに枠を食い潰す。
-- 弾かれた要求も枠を消費するので、上限を決めておく。
--
-- 計算: 定例の取得が 14回/日 × 325地点 = 4,550回。無料枠は10,000回/日。
--       残りは約5,450回。1回の取り直しは1分割 ≒ 54地点なので、
--       1日60回まで(約3,240回)に抑えても、まだ2,000回以上の余白が残る。
--       60回あれば、6分割すべてが失敗する周回を1日に10回ぶん救える。
create table if not exists public.stars_weather_budget (
  day     date primary key,
  retries int not null default 0
);

alter table public.stars_weather_budget enable row level security;
revoke all on table public.stars_weather_budget from anon, authenticated;


-- ---- ⑥-2 まだ揃っていない分割を1つだけ投げ直す ----
-- 一度に1つだけにするのは、まとめて投げると上流の「600回/分」に当たるため。
-- 2分おきに呼べば、6分割すべてが失敗していても12分で揃う。
-- 全部が200なら何も投げないので、ふだんは上流への呼び出しは発生しない。
create or replace function public.stars_weather_retry_one()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  parts       int := (public.stars_grid_def()->>'parts')::int;
  daily_limit int := 60;
  used        int;
  target      int;
begin
  -- 遅れている分割のうち、いちばん若い番号を1つだけ選ぶ。
  -- 一度に1つにするのは、まとめて投げると上流の「600回/分」に当たるため。
  -- 判定は stars_weather_part_stale に集約してある(要求側と同じ条件を使う)。
  select i into target
  from generate_series(1, parts) i
  where public.stars_weather_part_stale(i)
  order by i
  limit 1;

  if target is null then
    return null; -- 全部そろっている。上流へは何も投げない
  end if;

  -- 今日ぶんの枠を確かめて確保する
  insert into public.stars_weather_budget (day, retries)
  values (current_date, 0)
  on conflict (day) do nothing;

  update public.stars_weather_budget
     set retries = retries + 1
   where day = current_date and retries < daily_limit
  returning retries into used;

  if used is null then
    -- 使い切った。追いかけをやめ、次の定例まで前回のキャッシュで持たせる。
    insert into public.stars_weather_status (kind, ok, detail, at)
    values ('grid', false,
            '取り直しの枠(1日' || daily_limit || '回)を使い切りました。次の定例取得を待ちます。',
            now())
    on conflict (kind) do update
      set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
    return null;
  end if;

  perform public.stars_weather_request(target, true);
  return target;
end;
$$;

revoke all on function public.stars_weather_retry_one() from public, anon, authenticated;


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
  -- 毎時0分は世界中の定期実行が集中するので少し外す。
  -- ただしこれは気休めで、安定させているのは下の「揃うまで投げ直す」ほう。
  first int := 7;
  i     int;
  name  text;
begin
  for name in
    select jobname from cron.job where jobname like 'stars-weather%'
  loop
    perform cron.unschedule(name);
  end loop;

  /*
   * ① 決められた時刻に、全分割を1分ずつずらして投げる。
   *    ここが「いつ更新するか」を決めている本体。
   */
  for i in 1..parts loop
    perform cron.schedule(
      'stars-weather-request-' || i,
      (first + i - 1) || ' ' || hours || ' * * *',
      format('select public.stars_weather_request(%s);', i)
    );
  end loop;

  /*
   * ② 揃っていない分割を2分おきに1つずつ投げ直す(常時)。
   *
   *    上流は無料で提供されている以上、いつでも 503 を返しうる。
   *    1回の失敗で次の定期更新まで古いままになるのが従来の弱点だった。
   *    ここで揃うまで自動的に追いかけるので、
   *    6分割すべてが失敗しても12分で揃い、そのあと自然に取り込まれる。
   *
   *    全部が200のときは何も投げない(上流への呼び出しは発生しない)ので、
   *    常時動かしても枠は消費しない。
   *    追いかけるのはいちばん新しい周回だけ。投げ直しても周回は変わらないので、
   *    「投げ直した分割だけ新しい周回になって永久に揃わない」ことは起きない。
   */
  perform cron.schedule(
    'stars-weather-retry',
    '*/2 * * * *',
    'select public.stars_weather_retry_one();'
  );

  /*
   * ③ 5分おきに取り込みを試す(常時)。
   *    全分割が揃った時点で自動的に反映される。
   *    同じ周回を取り込み済みなら何もしないので、書き直しは起きない。
   */
  perform cron.schedule(
    'stars-weather-collect',
    '*/5 * * * *',
    'select public.stars_weather_collect();'
  );
end;
$do$;


-- ---- ⑧ 取りに行く地点を組み立てる ----
-- 並びは `node scripts/stars/land_grid.mjs --mask` で作り直せる。
-- 対象地域や格子の刻みを変えたら、必ず作り直してここを差し替えること。
select public.stars_grid_build(
  '111111111111111111111100111111111111111101111111111111111111111001111111111111111111110011111111111111111111100011111111111111111000000011111100111111110000000011111000111111100000000111111000111111111100011111110000111111111111111111110000101111110111111111100000001111111111111111100000001111111111111111000000000111111111111011000000000001111111000011100000100001111100000001100000100000111100000001100000100000111000000000000000000011111000000001111000000111110000000001111000111111101100000000111000111100001100000000110000111100000000000000110000'
) as 取りに行く地点数;


-- ---- ⑨ 今すぐ1回ぶんだけ試す ----
-- 全分割をここで投げると1分あたりの上限に当たるので、1つだけにしておく。
-- 残りは次の定期実行で揃う。
select public.stars_weather_request(1) as 要求id;
