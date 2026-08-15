-- =============================================================
-- 星見スポット: 天気キャッシュの取り込みの回帰テスト
--
-- 何を確かめるか:
--   新しい周回と古い周回が混ざったまま公開されないこと。
--   壊れた応答・欠けた応答が「快晴0%」に化けないこと。
--
--   2026-08-14 に、分割1〜4が新しく分割5〜6が3時間前という状態で
--   取り込みが通り、552地点のうち270地点が3時間前の値のまま
--   新しい時刻の欄に並んだ。画面には何の異常も出なかった。
--   同じことが二度と通らないよう、失敗するはずのものが確実に失敗することを見る。
--
-- どこで走らせるか:
--   隔離した PostgreSQL。本番の Supabase では絶対に走らせないこと
--   (キャッシュを書き換えるうえ、pg_net / pg_cron を作り物に差し替えるため)。
--   走らせ方は scripts/stars/pgtest.sh を使う。
-- =============================================================

\set ON_ERROR_STOP on
\pset pager off

-- 途中の select の出力は読まない(最後にまとめて結果を出す)
\o /dev/null

-- ---- 判定の道具 --------------------------------------------------------
create table if not exists test_result (
  n       serial primary key,
  ok      boolean not null,
  label   text not null,
  detail  text
);

create or replace function t_ok(p_cond boolean, p_label text, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into test_result (ok, label, detail) values (coalesce(p_cond, false), p_label, p_detail);
end;
$$;

-- ---- 作り物の応答 ------------------------------------------------------
--
-- Open-Meteo の応答のかたちを組み立てる。
--   p_points   地点数
--   p_times    時刻の並び(unixtime)
--   p_cloud    雲量。全時間で同じ値にして、どの周回のデータかを見分ける目印にする
create or replace function fake_body(p_points int, p_times jsonb, p_cloud int)
returns text language sql as $$
  select jsonb_agg(
    jsonb_build_object('hourly', jsonb_build_object(
      'time', p_times,
      'cloud_cover', (select jsonb_agg(p_cloud) from generate_series(1, jsonb_array_length(p_times))),
      'precipitation_probability', (select jsonb_agg(0) from generate_series(1, jsonb_array_length(p_times))),
      'visibility', (select jsonb_agg(24000) from generate_series(1, jsonb_array_length(p_times))),
      'relative_humidity_2m', (select jsonb_agg(50) from generate_series(1, jsonb_array_length(p_times)))
    ))
  )::text
  from generate_series(1, p_points);
$$;

-- よく使う時刻の並び(78時間ぶん)
create or replace function fake_times(p_base bigint)
returns jsonb language sql as $$
  select jsonb_agg(p_base + (i - 1) * 3600) from generate_series(1, 78) i;
$$;

/*
 * 「分割 p_part の応答が届いた」状態を作る。
 * 実際の pg_net と同じく net._http_response に行を足し、
 * pending の request_id をそれに向ける。
 */
create or replace function arrive(
  p_part int, p_status int, p_body text)
returns void language plpgsql as $$
declare rid bigint;
begin
  select request_id into rid from stars_weather_pending where kind = 'grid' and part = p_part;
  delete from net._http_response where id = rid;
  insert into net._http_response (id, status_code, content, error_msg)
  values (rid, p_status, p_body, case when p_status = 200 then null else 'HTTP ' || p_status end);
end;
$$;

/* 分割 p_part が「正常に届いた」状態にする(雲量で周回を見分ける) */
create or replace function arrive_ok(p_part int, p_times jsonb, p_cloud int)
returns void language plpgsql as $$
declare n int;
begin
  select count(*) into n from stars_grid_points(p_part);
  perform arrive(p_part, 200, fake_body(n, p_times, p_cloud));
end;
$$;

/* 周回をまるごと投げる(cron の定例と同じ動き) */
create or replace function request_cycle()
returns void language plpgsql as $$
declare parts int := (stars_grid_def()->>'parts')::int; i int;
begin
  for i in 1..parts loop perform stars_weather_request(i); end loop;
end;
$$;

/* 状態をまっさらに戻す */
create or replace function reset_all() returns void language sql as $$
  delete from stars_weather_pending;
  delete from stars_weather_cache;
  delete from stars_weather_status;
  delete from stars_weather_budget;
  delete from net._http_response;
  delete from net_request_log;
$$;

-- 現在のキャッシュの雲量(1地点目・1時間目)。どの周回が公開されたかを見る
create or replace function cache_cloud() returns int language sql as $$
  select (payload->'cloud'->0->>0)::int from stars_weather_cache where kind = 'grid';
$$;

create or replace function cache_time0() returns bigint language sql as $$
  select (payload->'times'->>0)::bigint from stars_weather_cache where kind = 'grid';
$$;


-- =============================================================
-- 1. 旧周回が全部そろっていて、新周回は分割1〜4だけ届いた
--    → 公開しない。キャッシュは旧周回のまま。
--    (これが 2026-08-14 に実際にすり抜けた組み合わせ)
-- =============================================================
select reset_all();
select set_now('2026-08-14 01:07:00+00');
select request_cycle();
select arrive_ok(i, fake_times(1000000), 11) from generate_series(1, 6) i;
select t_ok(stars_weather_collect() = 6, '1-a 旧周回は公開される');
select t_ok(cache_cloud() = 11, '1-b 旧周回の値が入る', '雲量 ' || cache_cloud());

-- 3時間後の新しい周回。分割1〜4だけが届く。
select set_now('2026-08-14 04:07:00+00');
select request_cycle();
select arrive_ok(i, fake_times(1010800), 22) from generate_series(1, 4) i;
-- 分割5・6は前の周回の応答がそのまま残っている(request_id は新しくなっているので届いていない)
select t_ok(stars_weather_collect() = 0, '1-c 揃っていないので公開しない');
select t_ok(cache_cloud() = 11, '1-d キャッシュは旧周回のまま', '雲量 ' || cache_cloud());
select t_ok(cache_time0() = 1000000, '1-e 時刻の並びも旧周回のまま');


-- =============================================================
-- 2. 新周回が6分割そろった → 1回だけ公開する
-- =============================================================
select arrive_ok(i, fake_times(1010800), 22) from generate_series(5, 6) i;
select t_ok(stars_weather_collect() = 6, '2-a 揃ったので公開する');
select t_ok(cache_cloud() = 22, '2-b 新周回の値になる', '雲量 ' || cache_cloud());
select t_ok(cache_time0() = 1010800, '2-c 時刻の並びも新周回');
select t_ok(stars_weather_collect() = -1, '2-d 同じ周回は二度公開しない');
select t_ok(stars_weather_collect() = -1, '2-e 何度呼ばれても公開しない');


-- =============================================================
-- 3. 分割3だけ失敗 → 取り直しが成功すれば、同じ周回として公開する
-- =============================================================
select reset_all();
select set_now('2026-08-14 07:07:00+00');
select request_cycle();
select arrive_ok(i, fake_times(1021600), 33) from generate_series(1, 6) i where i <> 3;
select arrive(3, 503, '{"error":true,"reason":"The service is overloaded"}');
select t_ok(stars_weather_collect() = 0, '3-a 失敗した分割があるので公開しない');
select t_ok(
  (select ok = false and detail like 'part 3:%' from stars_weather_status where kind = 'grid'),
  '3-b 失敗した分割の番号が記録される',
  (select detail from stars_weather_status where kind = 'grid'));

-- 取り直し。新しい周回を作らず、同じ周回のまま投げ直す。
select set_now('2026-08-14 07:16:00+00');
select t_ok(stars_weather_retry_one() = 3, '3-c 遅れている分割3を選ぶ');
select t_ok(
  (select count(distinct cycle_at) = 1 from stars_weather_pending where kind = 'grid'),
  '3-d 取り直しでも周回は増えない',
  (select string_agg(distinct cycle_at::text, ' / ') from stars_weather_pending where kind = 'grid'));
select arrive_ok(3, fake_times(1021600), 33);
select t_ok(stars_weather_collect() = 6, '3-e 取り直しが届けば公開する');
select t_ok(cache_cloud() = 33, '3-f 値が入れ替わる', '雲量 ' || cache_cloud());


-- =============================================================
-- 4. 応答が届く順番は関係ない
-- =============================================================
select reset_all();
select set_now('2026-08-14 10:07:00+00');
select request_cycle();
select arrive_ok(i, fake_times(1032400), 44) from generate_series(1, 6) i order by i desc;
select t_ok(stars_weather_collect() = 6, '4-a 逆順に届いても公開する');
select t_ok(cache_cloud() = 44, '4-b 値が正しい', '雲量 ' || cache_cloud());
-- 各分割の地点数ぶんが正しい位置に並んでいるか(全552地点)
select t_ok(
  (select jsonb_array_length(payload->'cloud') = 552 from stars_weather_cache where kind = 'grid'),
  '4-c 552地点ぶんに戻る');


-- =============================================================
-- 5. 応答の行が消えた(pg_net の TTL) → 前回のキャッシュを保ち、理由を残す
-- =============================================================
select set_now('2026-08-14 13:07:00+00');
select request_cycle();
select arrive_ok(i, fake_times(1043200), 55) from generate_series(1, 5) i;
-- 分割6の応答だけ最初から無い
select t_ok(stars_weather_collect() = 0, '5-a 応答が無ければ公開しない');
select t_ok(cache_cloud() = 44, '5-b 前回のキャッシュが残る', '雲量 ' || cache_cloud());
select t_ok(
  (select ok = false and detail like '%part 6%' from stars_weather_status where kind = 'grid'),
  '5-c 理由が残る',
  (select detail from stars_weather_status where kind = 'grid'));


-- =============================================================
-- 6. 分割数を変えても古い分割が混ざらない
-- =============================================================
select reset_all();
select set_now('2026-08-15 01:07:00+00');
select request_cycle();
select arrive_ok(i, fake_times(1054000), 66) from generate_series(1, 6) i;
select t_ok(stars_weather_collect() = 6, '6-a 6分割で公開できる');

-- 5分割に変える
create or replace function public.stars_grid_def() returns jsonb language sql immutable as $$
  select jsonb_build_object('south',24,'north',46,'west',123,'east',146,'step',1,
                            'hours',78,'parts',5);
$$;
select set_now('2026-08-15 04:07:00+00');
select stars_weather_request(1);
select t_ok(stars_weather_collect() = 0, '6-b 分割数を変えた直後は公開しない');
select t_ok(cache_cloud() = 66, '6-c 前のキャッシュが残る', '雲量 ' || cache_cloud());
select stars_weather_request(i) from generate_series(2, 5) i;
select arrive_ok(i, fake_times(1064800), 77) from generate_series(1, 5) i;
select t_ok(stars_weather_collect() = 5, '6-d 5分割で揃えば公開する');
select t_ok(cache_cloud() = 77, '6-e 新しい値になる', '雲量 ' || cache_cloud());
select t_ok(
  (select count(*) = 5 from stars_weather_pending where kind = 'grid'),
  '6-f 6番目の古い行は消える',
  (select count(*)::text from stars_weather_pending where kind = 'grid'));

-- 6分割へ戻す
create or replace function public.stars_grid_def() returns jsonb language sql immutable as $$
  select jsonb_build_object('south',24,'north',46,'west',123,'east',146,'step',1,
                            'hours',78,'parts',6);
$$;


-- =============================================================
-- 7. 壊れた応答を弾く(指示書4のサーバー側)
-- =============================================================
create or replace function case_bad(p_label text, p_body text)
returns void language plpgsql as $$
declare before int;
begin
  perform set_now('2026-08-16 01:07:00+00');
  perform reset_all();
  perform request_cycle();
  perform arrive_ok(i, fake_times(1075600), 88) from generate_series(1, 6) i;
  perform stars_weather_collect();          -- まず正常な周回を1つ公開しておく
  before := cache_cloud();

  perform set_now('2026-08-16 04:07:00+00');
  perform request_cycle();
  perform arrive_ok(i, fake_times(1086400), 99) from generate_series(1, 5) i;
  perform arrive(6, 200, p_body);           -- 分割6だけ壊れた応答

  perform t_ok(stars_weather_collect() = 0, p_label || ': 公開しない');
  perform t_ok(cache_cloud() = before, p_label || ': 前回のキャッシュが残る',
               '雲量 ' || cache_cloud());
  perform t_ok((select not ok from stars_weather_status where kind = 'grid'),
               p_label || ': 理由が残る',
               (select detail from stars_weather_status where kind = 'grid'));
end;
$$;

select case_bad('7-1 壊れたJSON', '{"hourly": ');
select case_bad('7-2 HTTP200のエラーJSON', '{"error":true,"reason":"Daily API request limit exceeded"}');
select case_bad('7-3 配列でない', '{"hourly":{"time":[1,2,3]}}');
select case_bad('7-4 地点が足りない',
  (select fake_body(3, fake_times(1086400), 99)));
select case_bad('7-5 雲量が無い', (
  select jsonb_agg(jsonb_build_object('hourly', jsonb_build_object(
    'time', fake_times(1086400),
    'precipitation_probability', (select jsonb_agg(0) from generate_series(1,78)),
    'visibility', (select jsonb_agg(24000) from generate_series(1,78)),
    'relative_humidity_2m', (select jsonb_agg(50) from generate_series(1,78))
  )))::text from generate_series(1, (select count(*) from stars_grid_points(6)))));
select case_bad('7-6 視程が無い', (
  select jsonb_agg(jsonb_build_object('hourly', jsonb_build_object(
    'time', fake_times(1086400),
    'cloud_cover', (select jsonb_agg(0) from generate_series(1,78)),
    'precipitation_probability', (select jsonb_agg(0) from generate_series(1,78)),
    'relative_humidity_2m', (select jsonb_agg(50) from generate_series(1,78))
  )))::text from generate_series(1, (select count(*) from stars_grid_points(6)))));
select case_bad('7-7 時刻の並びが他の分割と違う',
  (select fake_body((select count(*)::int from stars_grid_points(6)), fake_times(9999999), 99)));
select case_bad('7-8 配列が短い', (
  select jsonb_agg(jsonb_build_object('hourly', jsonb_build_object(
    'time', fake_times(1086400),
    'cloud_cover', (select jsonb_agg(0) from generate_series(1,10)),  -- 78 のはずが 10
    'precipitation_probability', (select jsonb_agg(0) from generate_series(1,78)),
    'visibility', (select jsonb_agg(24000) from generate_series(1,78)),
    'relative_humidity_2m', (select jsonb_agg(50) from generate_series(1,78))
  )))::text from generate_series(1, (select count(*) from stars_grid_points(6)))));
select case_bad('7-9 値が範囲外(雲量999)',
  (select fake_body((select count(*)::int from stars_grid_points(6)), fake_times(1086400), 999)));
select case_bad('7-10 値が文字列', (
  select jsonb_agg(jsonb_build_object('hourly', jsonb_build_object(
    'time', fake_times(1086400),
    'cloud_cover', (select jsonb_agg('0'::text) from generate_series(1,78)),
    'precipitation_probability', (select jsonb_agg(0) from generate_series(1,78)),
    'visibility', (select jsonb_agg(24000) from generate_series(1,78)),
    'relative_humidity_2m', (select jsonb_agg(50) from generate_series(1,78))
  )))::text from generate_series(1, (select count(*) from stars_grid_points(6)))));


-- =============================================================
-- 8. 先頭が null でも 0 に化けない(サイト側と合わせてサーバー側でも通す)
--    null は「値なし」として通し、快晴として扱われないことはサイト側で見る。
-- =============================================================
select reset_all();
select set_now('2026-08-17 01:07:00+00');
select request_cycle();
select arrive_ok(i, fake_times(1097200), 12) from generate_series(1, 5) i;
select arrive(6, 200, (
  select jsonb_agg(jsonb_build_object('hourly', jsonb_build_object(
    'time', fake_times(1097200),
    'cloud_cover', jsonb_build_array(null::int) || (select jsonb_agg(12) from generate_series(1,77)),
    'precipitation_probability', (select jsonb_agg(0) from generate_series(1,78)),
    'visibility', (select jsonb_agg(24000) from generate_series(1,78)),
    'relative_humidity_2m', (select jsonb_agg(50) from generate_series(1,78))
  )))::text from generate_series(1, (select count(*) from stars_grid_points(6)))));
select t_ok(stars_weather_collect() = 6, '8-a null を含む値は通す(欠測は正常な応答)');


-- =============================================================
-- 9. 取り直しの枠は上限を超えない
-- =============================================================
select reset_all();
select set_now('2026-08-18 01:07:00+00');
select request_cycle();
-- 全分割が失敗し続ける状況を作る
select arrive(i, 503, '{"error":true}') from generate_series(1, 6) i;
do $$
declare i int; n int := 0;
begin
  for i in 1..200 loop
    perform set_now(('2026-08-18 01:07:00+00'::timestamptz + (i * interval '2 minutes'))::text);
    if stars_weather_retry_one() is not null then n := n + 1; end if;
    -- 投げ直したぶんも失敗させる
    perform arrive(p, 503, '{"error":true}') from generate_series(1, 6) p;
  end loop;
  perform t_ok(n <= 60, '9-a 取り直しは1日60回を超えない', n || ' 回');
  perform t_ok(n = 60, '9-b 枠いっぱいまでは追いかける', n || ' 回');
  perform t_ok((select retries <= 60 from stars_weather_budget where day = current_date),
               '9-c 枠の記録も上限内',
               (select retries::text from stars_weather_budget where day = current_date));
end;
$$;
select t_ok(
  (select detail like '%使い切り%' from stars_weather_status where kind = 'grid'),
  '9-d 使い切ったことが分かる',
  (select detail from stars_weather_status where kind = 'grid'));


-- =============================================================
-- 10. 投げた直後の分割は「遅れている」とみなさない(無駄な投げ直しを防ぐ)
-- =============================================================
select reset_all();
select set_now('2026-08-19 01:07:00+00');
select request_cycle();
select t_ok(
  not exists (select 1 from generate_series(1,6) i where stars_weather_part_stale(i)),
  '10-a 投げた直後は遅れている扱いにしない');
select set_now('2026-08-19 01:12:00+00');
select t_ok(
  (select count(*) = 6 from generate_series(1,6) i where stars_weather_part_stale(i)),
  '10-b 3分たっても応答が無ければ遅れている扱い');


\o
-- ---- 結果 ----------------------------------------------------------
select n, case when ok then 'ok  ' else '失敗' end as 判定, label as 内容,
       coalesce(detail, '') as 詳細
from test_result order by n;

select count(*) filter (where not ok) || ' 件失敗 / ' || count(*) || ' 件' as 合計
from test_result;

do $$
declare bad int;
begin
  select count(*) into bad from test_result where not ok;
  if bad > 0 then
    raise exception '% 件失敗しました', bad;
  end if;
end;
$$;
