#!/usr/bin/env bash
#
# setup.sql が「まっさらな環境」でも「すでに動いている環境」でも通ることを確かめる。
#
# なぜ要るか:
#   列を1つ足すたびに、本番でどうなるかを頭の中で想像していた。
#   実際に確かめないまま Hiroさんに SQL を渡すのは、
#   壊れるかどうかを利用者に試させるのと同じ。
#   使い捨てのデータベースで、次の2つを実際にやってみる:
#     1. 何も無い状態に流す
#     2. 古い版が入っている状態に、新しい版を上書きで流す(本番と同じ状況)
#
# 使い方:
#   scripts/stars/setup.test.sh [比較したい古い版のパス]
#   省略すると OLD_SETUP_REF の版を使う。
#
# なぜ「直前のコミット」ではなく決め打ちの版なのか:
#   直前のコミットを古い版として使っていたが、city / caution を足したあとは
#   直前のコミットにもその列があるため、「列を足す道筋」を通らなくなった。
#   テストが何も試さないまま緑になる。列を足す前の版を名指しで指す。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGTEST_PORT:-55433}"
BASE="${PGTEST_DIR:-/tmp/stars-setuptest-$$}"
OLD_SQL="${1:-}"
# city / caution を足す前の版(この道筋を通したいので決め打ちにする)
OLD_SETUP_REF="${OLD_SETUP_REF:-6f6e29a}"

if ! command -v initdb >/dev/null 2>&1; then
  for d in /usr/lib/postgresql/*/bin; do
    [ -x "$d/initdb" ] && export PATH="$d:$PATH" && break
  done
fi
command -v initdb >/dev/null 2>&1 || { echo "PostgreSQL が必要です。" >&2; exit 1; }

RUNAS=""
if [ "$(id -u)" = "0" ]; then RUNAS="postgres"; fi
run() {
  if [ -n "$RUNAS" ]; then su "$RUNAS" -c "export PATH='$PATH'; $1"; else bash -c "$1"; fi
}

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

# Supabase 側にあるもの(役割・拡張・管理トークンの置き場)を最小限そろえる
$PSQL >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create extension if not exists pgcrypto;
create table if not exists public.admin_config (key text primary key, value text not null);
insert into public.admin_config (key, value) values ('stars_ops_token','test-token')
  on conflict (key) do nothing;
SQL

if [ -z "$OLD_SQL" ]; then
  OLD_SQL="$BASE/old.sql"
  git -C "$ROOT" show "$OLD_SETUP_REF:scripts/stars/setup.sql" > "$OLD_SQL"
fi

fail=0
ok()   { echo "  ok   $1"; }
ng()   { echo "  FAIL $1"; fail=$((fail+1)); }

echo "1) まっさらな環境に流す"
if $PSQL -f "$HERE/setup.sql" >/dev/null 2>"$BASE/e1"; then ok "通った"; else ng "失敗: $(tail -2 "$BASE/e1")"; fi

echo "2) もう一度流す(何度流しても壊れないこと)"
if $PSQL -f "$HERE/setup.sql" >/dev/null 2>"$BASE/e2"; then ok "通った"; else ng "失敗: $(tail -2 "$BASE/e2")"; fi

echo "3) 古い版を入れてから、新しい版を上書きで流す(本番と同じ状況)"
# 前の場面の残りを完全に消す。関数は戻り値の型が変わると置き換えられないので、
# 表だけでなく関数も落とす(ここを漏らして、テスト自身が誤検知した)。
reset_schema() {
  $PSQL >/dev/null <<'SQL'
drop function if exists public.stars_public_spots(text);
drop function if exists public.stars_ops_pending(text, int);
drop function if exists public.stars_ops_approved(text, int);
drop function if exists public.stars_ops_approve(text, uuid);
drop function if exists public.stars_ops_reject(text, uuid, text);
drop function if exists public.stars_ops_delete(text, uuid);
drop table if exists public.stars_spots cascade;
drop table if exists public.stars_prefectures cascade;
SQL
}
reset_schema
if $PSQL -f "$OLD_SQL" >/dev/null 2>"$BASE/e3"; then ok "古い版が入った"; else ng "古い版の投入に失敗: $(tail -2 "$BASE/e3")"; fi

# 古い版の時点では新しい列が無いことを確かめる(前提の確認)
before=$($PSQL -tAc "select count(*) from information_schema.columns
  where table_name='stars_spots' and column_name in ('city','caution');" | tr -d '[:space:]')
if [ "$before" = "0" ]; then ok "古い版には city / caution が無い(前提どおり)"; else ng "古い版に既にある($before 列)"; fi

if $PSQL -f "$HERE/setup.sql" >/dev/null 2>"$BASE/e4"; then ok "新しい版を上書きできた"; else ng "上書きに失敗: $(tail -2 "$BASE/e4")"; fi

after=$($PSQL -tAc "select count(*) from information_schema.columns
  where table_name='stars_spots' and column_name in ('city','caution');" | tr -d '[:space:]')
if [ "$after" = "2" ]; then ok "city / caution が増えた"; else ng "列が増えていない($after 列)"; fi

echo "4) 申請フォームが送る形の登録が通ること"
# submit.js が送る項目をそのまま並べる(空欄は null で送られる)
if $PSQL >/dev/null 2>"$BASE/e5" <<'SQL'
insert into public.stars_spots
  (name, name_kana, pref, city, lat, lon, elevation_m, access, facilities, note, caution, source_url, submitter_hint)
values
  ('検査用スポット', null, '長野県', '阿智村', 35.44, 137.68, 1200, null, null, null, '冬期は積雪', null, 'testdevice1234');
SQL
then ok "city / caution を含む登録が通った"; else ng "登録に失敗: $(tail -2 "$BASE/e5")"; fi

echo "5) 古い版のままだと、その登録が弾かれること(放置したときに何が起きるか)"
reset_schema
$PSQL -f "$OLD_SQL" >/dev/null 2>&1
if $PSQL >/dev/null 2>"$BASE/e6" <<'SQL'
insert into public.stars_spots
  (name, pref, city, lat, lon, caution, submitter_hint)
values ('検査用スポット', '長野県', '阿智村', 35.44, 137.68, '冬期は積雪', 'testdevice1234');
SQL
then ng "古い版でも通ってしまった(想定と違う)"; else ok "古い版では弾かれる: $(grep -o 'column "[a-z_]*" of relation.*' "$BASE/e6" | head -1)"; fi

echo "6) 上書き後、公開RPC が新しい列を返すこと"
$PSQL -f "$HERE/setup.sql" >/dev/null 2>&1
cols=$($PSQL -tAc "select string_agg(p.name, ',' order by p.ord)
  from pg_proc f
  join lateral unnest(f.proallargtypes, f.proargnames) with ordinality as p(typ, name, ord) on true
  where f.proname='stars_public_spots';" | tr -d '[:space:]')
case "$cols" in
  *city*caution*|*caution*city*) ok "公開RPC が返す: $cols" ;;
  *) ng "公開RPC に city / caution が無い: $cols" ;;
esac

echo
if [ "$fail" -eq 0 ]; then
  echo "すべて通過"
else
  echo "$fail 件失敗" >&2
  exit 1
fi
