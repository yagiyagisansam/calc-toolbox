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
python3 - "$HERE/weather-cache.sql" "$BASE/schema.sql" <<'PY'
import io, sys
src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding="utf-8").read()

cut  = s.index("-- ---- ⑦ 定期実行 ----")
grid = s.index("-- ---- ⑧ 取りに行く地点を組み立てる ----")
end  = s.index("-- ---- ⑨ 今すぐ1回ぶんだけ試す ----")
s = s[:cut] + s[grid:end]

# 拡張はこの環境に無い。pgtest_stubs.sql の作り物で代用する。
s = s.replace("create extension if not exists pg_cron;", "")
s = s.replace("create extension if not exists pg_net;", "")

# テストで時刻を操れるようにする。
#
# PostgreSQL は search_path に pg_catalog を書かない限り、pg_catalog を
# いちばん先に見る。そのままだと now() は必ず本物になり、
# 「3時間後の周回」のような場面を実際に3時間待たずには作れない。
# public を先に見るようにして、pgtest_stubs.sql の public.now() を使わせる。
# 置き換えるのは名前の解決順だけで、関数の中身は本番と同じものを試す。
n = s.count("set search_path = public\n")
assert n >= 5, "search_path の書き換え対象が見つかりません (%d 件)" % n
s = s.replace("set search_path = public\n", "set search_path = public, pg_catalog\n")

io.open(dst, "w", encoding="utf-8").write(s)
PY
$PSQL -f "$BASE/schema.sql" >/dev/null

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
