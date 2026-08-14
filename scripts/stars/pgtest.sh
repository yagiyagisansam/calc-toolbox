#!/usr/bin/env bash
#
# 隔離した PostgreSQL で weather-cache.sql の回帰テストを走らせる。
#
# なぜ隔離するか:
#   本番の Supabase で走らせるとキャッシュを壊す。
#   このテストは pg_net / pg_cron を作り物に置き換えるので、なおさら本番では走らせない。
#
# 必要なもの: PostgreSQL 14 以降(拡張は不要。pg_net / pg_cron は作り物で代用する)
#
# 使い方:
#   scripts/stars/pgtest.sh
#
# 何をするか:
#   1. 使い捨てのデータベースクラスタを作って起動する
#   2. pg_net / pg_cron の代わりになる作り物を入れる
#   3. weather-cache.sql を流す
#   4. weather-cache.test.sql を流す
#   5. 後片付けする(失敗しても消す)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGTEST_PORT:-55432}"
BASE="${PGTEST_DIR:-/tmp/stars-pgtest-$$}"

# PostgreSQL のコマンドを探す。Debian/Ubuntu は PATH に入っていないことがある。
if ! command -v initdb >/dev/null 2>&1; then
  for d in /usr/lib/postgresql/*/bin; do
    [ -x "$d/initdb" ] && export PATH="$d:$PATH" && break
  done
fi
command -v initdb >/dev/null 2>&1 || {
  echo "PostgreSQL が見つかりません。initdb / pg_ctl / psql が必要です。" >&2
  exit 1
}

# root では PostgreSQL を起動できないので、専用の利用者に降りる
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  RUNAS="postgres"
  id "$RUNAS" >/dev/null 2>&1 || { echo "root で走らせるには postgres 利用者が必要です。" >&2; exit 1; }
fi

# su は環境変数を引き継がないので、PATH を明示的に渡す
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

echo "使い捨てのデータベースを作ります: $BASE"
run "initdb -D '$BASE/data' -U postgres --auth=trust -E UTF8" >/dev/null
run "pg_ctl -D '$BASE/data' -o '-p $PORT -k $BASE -c listen_addresses=' -l '$BASE/log' -w start" >/dev/null

PSQL="psql -h $BASE -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

echo "pg_net / pg_cron の代わりを入れます"
$PSQL -f "$HERE/pgtest_stubs.sql" >/dev/null

echo "weather-cache.sql を流します"
# 本番向けの cron 登録と「いますぐ1回投げる」は、テストでは邪魔なので落とす。
# 落とす箇所は行番号ではなく見出しで探す(SQL を編集してもずれないように)。
python3 "$HERE/pgtest_trim.py" "$HERE/weather-cache.sql" "$BASE/schema.sql"
$PSQL -f "$BASE/schema.sql" >/dev/null

# ---- 既に古い版が動いている環境へ上書きできるか ----
#
# 本番はまっさらではない。列を足したり関数の形を変えたりしたとき、
# 上書きで流して通るかは実際にやってみないと分からない
# (setup.sql では create or replace で関数を置き換えられず途中停止した)。
echo
echo "古い版への上書き:"
OLD_WC="$BASE/old-weather-cache.sql"
if git -C "$ROOT" show 38ba645:scripts/stars/weather-cache.sql > "$OLD_WC" 2>/dev/null; then
  $PSQL -c "drop schema if exists public cascade; create schema public;" >/dev/null
  $PSQL -f "$HERE/pgtest_stubs.sql" >/dev/null
  python3 "$HERE/pgtest_trim.py" "$OLD_WC" "$BASE/old-schema.sql"

  if $PSQL -f "$BASE/old-schema.sql" >/dev/null 2>"$BASE/wc1"; then
    echo "  ok   古い版が入った"
  else
    echo "  失敗 古い版の投入: $(tail -2 "$BASE/wc1")" >&2; exit 1
  fi

  # 本番と同じく、取得中の要求が残っている状態にしておく
  $PSQL -c "insert into stars_weather_pending (kind, part, request_id, requested_at) values ('grid', 1, 1, now());" >/dev/null 2>&1 || true

  if $PSQL -f "$BASE/schema.sql" >/dev/null 2>"$BASE/wc2"; then
    echo "  ok   新しい版を上書きできた"
  else
    echo "  失敗 上書き: $(tail -3 "$BASE/wc2")" >&2; exit 1
  fi

  NN=$($PSQL -tAc "select is_nullable from information_schema.columns where table_name='stars_weather_pending' and column_name='cycle_at';" | tr -d "[:space:]")
  if [ "$NN" = "NO" ]; then
    echo "  ok   cycle_at が追加され、既存行も埋まった"
  else
    echo "  失敗 cycle_at が NOT NULL になっていない($NN)" >&2; exit 1
  fi
else
  echo "  info 古い版を取り出せないため、上書きの確認は省略"
fi

# 上書きの検査で中身を触ったので、本体のテストは作り直した環境で行う
$PSQL -c "drop schema if exists public cascade; create schema public;" >/dev/null
$PSQL -f "$HERE/pgtest_stubs.sql" >/dev/null
$PSQL -f "$BASE/schema.sql" >/dev/null

echo
echo "テストを流します"
echo
$PSQL -f "$HERE/weather-cache.test.sql"

# ---- 並行して取り込みが走っても公開は1回だけか ----
#
# 1つの SQL ファイルの中では、本当に同時に走らせることができない。
# 3つの接続を使って確実に競合させる:
#   見張り役が先に錠を取る → 取り込み2つがそこで待たされる
#   → 見張り役が離す → 2つが同時に動き出す
# 錠が効いていれば、先に入ったほうだけが公開し(6)、
# あとから入ったほうは「公開済み」を見て -1 を返す。
# 効いていなければ両方が 6 を返す。
echo
echo "並行実行の確認:"
$PSQL -f "$HERE/weather-cache.concurrency.sql" >/dev/null

LOCK_SQL="select pg_advisory_lock(hashtext('stars_weather_collect')); select pg_sleep(4);"
$PSQL -c "$LOCK_SQL" >/dev/null 2>&1 &
WATCH_PID=$!
sleep 1

$PSQL -tAc "select public.stars_weather_collect();" > "$BASE/a.out" 2>&1 &
A_PID=$!
$PSQL -tAc "select public.stars_weather_collect();" > "$BASE/b.out" 2>&1 &
B_PID=$!

wait $WATCH_PID $A_PID $B_PID 2>/dev/null || true

A=$(tr -d '[:space:]' < "$BASE/a.out")
B=$(tr -d '[:space:]' < "$BASE/b.out")
ROWS=$($PSQL -tAc "select count(*) from stars_weather_cache where kind='grid';" | tr -d '[:space:]')

echo "  取り込み1 → $A / 取り込み2 → $B / キャッシュの行数 → $ROWS"
if { [ "$A" = "6" ] && [ "$B" = "-1" ]; } || { [ "$A" = "-1" ] && [ "$B" = "6" ]; }; then
  if [ "$ROWS" = "1" ]; then
    echo "  ok   同時に走らせても公開は1回だけ"
  else
    echo "  失敗 キャッシュの行数が 1 ではありません" >&2
    exit 1
  fi
else
  echo "  失敗 どちらも公開してしまいました(錠が効いていません)" >&2
  exit 1
fi
