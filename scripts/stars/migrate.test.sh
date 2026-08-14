#!/usr/bin/env bash
#
# 本番へ渡す「差分だけのSQL」が、いま動いている版に対して本当に通るかを確かめる。
#
# なぜ要るか:
#   差分を切り出したファイルは、正本を流したときと同じ結果にならなければ意味がない。
#   実際、setup.sql をそのまま流す手順は、関数の戻り値の型が変わったせいで
#   途中停止した。それに気づかず渡していたら、Hiroさんが本番で踏んでいた。
#   渡す前に、古い版の上でこの差分を流し、正本と同じ形になることを見る。
#
# 使い方: scripts/stars/migrate.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGTEST_PORT:-55434}"
BASE="${PGTEST_DIR:-/tmp/stars-migtest-$$}"

# いま本番で動いている版(まだ差分を当てていない状態)
OLD_SETUP_REF="${OLD_SETUP_REF:-6f6e29a}"
OLD_WEATHER_REF="${OLD_WEATHER_REF:-38ba645}"

if ! command -v initdb >/dev/null 2>&1; then
  for d in /usr/lib/postgresql/*/bin; do
    [ -x "$d/initdb" ] && export PATH="$d:$PATH" && break
  done
fi
command -v initdb >/dev/null 2>&1 || { echo "PostgreSQL が必要です。" >&2; exit 1; }

RUNAS=""
if [ "$(id -u)" = "0" ]; then RUNAS="postgres"; fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "export PATH='$PATH'; $1"; else bash -c "$1"; fi; }
cleanup() {
  run "pg_ctl -D '$BASE/data' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$BASE"
}
trap cleanup EXIT

rm -rf "$BASE"; mkdir -p "$BASE"
[ -n "$RUNAS" ] && chown "$RUNAS" "$BASE"
run "initdb -D '$BASE/data' -U postgres --auth=trust -E UTF8" >/dev/null
run "pg_ctl -D '$BASE/data' -o '-p $PORT -k $BASE -c listen_addresses=' -l '$BASE/log' -w start" >/dev/null

PSQL="psql -h $BASE -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

fail=0
ok() { echo "  ok   $1"; }
ng() { echo "  FAIL $1"; fail=$((fail+1)); }

base_env() {
  # 作り直しの NOTICE は読む必要がないので静める
  $PSQL >/dev/null 2>&1 <<'SQL'
set client_min_messages = warning;
drop schema if exists public cascade;
create schema public;
create extension if not exists pgcrypto;
create table if not exists public.admin_config (key text primary key, value text not null);
insert into public.admin_config (key, value) values ('stars_ops_token','test-token')
  on conflict (key) do nothing;
SQL
}

echo "差分SQLを作り直します"
python3 "$HERE/build_migration.py" >/dev/null

# ============================================================
echo
echo "A) スポットの列(migrate-spot-columns.sql)"
base_env
$PSQL >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
SQL
git -C "$ROOT" show "$OLD_SETUP_REF:scripts/stars/setup.sql" > "$BASE/old-setup.sql"
$PSQL -f "$BASE/old-setup.sql" >/dev/null 2>&1
ok "いま動いている版を入れた"

# 申請が入っている状態を作る(本番にも未承認の行が残りうる)
$PSQL -c "insert into public.stars_spots (name, pref, lat, lon, submitter_hint)
          values ('既存の申請', '長野県', 35.4, 137.6, 'olddevice1234');" >/dev/null 2>&1 || true

if $PSQL -f "$HERE/generated/migrate-spot-columns.sql" >/dev/null 2>"$BASE/a1"; then
  ok "差分SQLが通った"
else
  ng "差分SQLが失敗: $(tail -3 "$BASE/a1")"
fi

got=$($PSQL -tAc "select count(*) from information_schema.columns
  where table_name='stars_spots' and column_name in ('city','caution');" | tr -d '[:space:]')
[ "$got" = "2" ] && ok "city / caution が増えた" || ng "列が増えていない($got)"

kept=$($PSQL -tAc "select count(*) from public.stars_spots;" | tr -d '[:space:]')
[ "$kept" = "1" ] && ok "既存の申請が消えていない" || ng "既存の行が消えた($kept)"

if $PSQL >/dev/null 2>"$BASE/a2" <<'SQL'
insert into public.stars_spots
  (name, name_kana, pref, city, lat, lon, elevation_m, access, facilities, note, caution, source_url, submitter_hint)
values ('新しい申請', null, '長野県', '阿智村', 35.44, 137.68, 1200, null, null, null, '冬期は積雪', null, 'newdevice1234');
SQL
then ok "申請フォームが送る形の登録が通る"; else ng "登録に失敗: $(tail -2 "$BASE/a2")"; fi

# 差分を当てた結果が、正本を流した結果と同じ形か
sig_after_migration=$($PSQL -tAc "select string_agg(p.name, ',' order by p.ord)
  from pg_proc f join lateral unnest(f.proallargtypes, f.proargnames)
  with ordinality as p(typ, name, ord) on true where f.proname='stars_public_spots';" | tr -d '[:space:]')

base_env
$PSQL >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
SQL
$PSQL -f "$HERE/setup.sql" >/dev/null 2>&1
sig_from_source=$($PSQL -tAc "select string_agg(p.name, ',' order by p.ord)
  from pg_proc f join lateral unnest(f.proallargtypes, f.proargnames)
  with ordinality as p(typ, name, ord) on true where f.proname='stars_public_spots';" | tr -d '[:space:]')

if [ "$sig_after_migration" = "$sig_from_source" ]; then
  ok "差分を当てた結果が、正本を流した結果と一致する"
else
  ng "一致しない: 差分=$sig_after_migration / 正本=$sig_from_source"
fi

# ============================================================
echo
echo "B) 天気キャッシュの周回(migrate-weather-cycle.sql)"
base_env
$PSQL -f "$HERE/pgtest_stubs.sql" >/dev/null
git -C "$ROOT" show "$OLD_WEATHER_REF:scripts/stars/weather-cache.sql" > "$BASE/old-weather.sql"
python3 "$HERE/pgtest_trim.py" "$BASE/old-weather.sql" "$BASE/old-weather-trimmed.sql"
$PSQL -f "$BASE/old-weather-trimmed.sql" >/dev/null 2>&1
ok "いま動いている版を入れた"

# 取得中の要求が残っている状態(本番と同じ)
$PSQL -c "insert into public.stars_weather_pending (kind, part, request_id, requested_at)
          values ('grid', 1, 101, now()), ('grid', 2, 102, now());" >/dev/null 2>&1 || true

if $PSQL -f "$HERE/generated/migrate-weather-cycle.sql" >/dev/null 2>"$BASE/b1"; then
  ok "差分SQLが通った"
else
  ng "差分SQLが失敗: $(tail -3 "$BASE/b1")"
fi

nn=$($PSQL -tAc "select is_nullable from information_schema.columns
  where table_name='stars_weather_pending' and column_name='cycle_at';" | tr -d '[:space:]')
[ "$nn" = "NO" ] && ok "cycle_at が必須列として入った" || ng "cycle_at が NOT NULL でない($nn)"

filled=$($PSQL -tAc "select count(*) from public.stars_weather_pending where cycle_at is not null;" | tr -d '[:space:]')
[ "$filled" = "2" ] && ok "既存の行にも周回が埋まった" || ng "埋まっていない($filled)"

has_cycle=$($PSQL -tAc "select count(*) from pg_proc where proname='stars_weather_cycle';" | tr -d '[:space:]')
[ "$has_cycle" = "1" ] && ok "stars_weather_cycle が作られた" || ng "作られていない"

has_valid=$($PSQL -tAc "select count(*) from pg_proc where proname='stars_weather_valid_series';" | tr -d '[:space:]')
[ "$has_valid" = "1" ] && ok "応答の検証関数が作られた" || ng "作られていない"

# 周回が「毎時ちょうど」になるか(古い版との違いがいちばん出るところ)。
#
# 差分SQLは本番用のまま流しているので、テスト用の時計(set_now)は効かない
# (search_path を書き換えていないため now() は本物になる)。
# なので特定の時刻ではなく「分と秒が 0 か」で見る。
# 古い版は投げた時刻の最大値をそのまま使うので、必ず分か秒が残る。
$PSQL -c "select public.stars_weather_request(1);" >/dev/null 2>&1 || true
cyc=$($PSQL -tAc "select public.stars_weather_cycle();")
sharp=$($PSQL -tAc "select extract(minute from public.stars_weather_cycle())::int
                     + extract(second from public.stars_weather_cycle())::int;" | tr -d '[:space:]')
if [ "$sharp" = "0" ]; then
  ok "周回が毎時ちょうどになった: $(echo "$cyc" | tr -d '[:space:]')"
else
  ng "周回に分・秒が残っている: $(echo "$cyc" | tr -d '[:space:]')"
fi

echo
if [ "$fail" -eq 0 ]; then echo "すべて通過"; else echo "$fail 件失敗" >&2; exit 1; fi
