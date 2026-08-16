#!/usr/bin/env bash
#
# 掲載スポットの登録SQL(generated/seed-spots.sql)を、使い捨てのデータベースで
# 実際に流してみる。
#
# なぜ要るか:
#   このSQLは Hiroさんが iPhone から Supabase の SQL エディタへ貼り付けて、
#   本番のデータベースに1回だけ流すもの。そこで初めて失敗すると、
#   何が起きたのかを手元で調べる術がない。
#   構文の誤り・制約違反・引き金との噛み合わせは、ここで先に出しておく。
#
# 何を確かめるか:
#   1. setup.sql を入れた状態に、登録SQLがそのまま通ること
#   2. 30件入り、30件とも approved になること
#   3. 椿山森林公園が入らないこと(除外したもの)
#   4. 座標を取り直した3件が、候補JSONのとおりに入ること
#   5. 全件に「気をつけること」と出典が入ること
#   6. region が引き金で埋まること(SQLには書いていない)
#   7. もう一度流しても増えないこと(貼り付けを二度やっても壊れない)
#   8. 先に申請フォームから来た行を、勝手に消したり書き換えたりしないこと
#
# 本番の Supabase には触れない。ここで立てるのは使い捨ての PostgreSQL。
#
# 使い方: scripts/stars/seed.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PGTEST_PORT:-55434}"
BASE="${PGTEST_DIR:-/tmp/stars-seedtest-$$}"
SEED="$HERE/generated/seed-spots.sql"

[ -f "$SEED" ] || { echo "$SEED がありません。build_seed_sql.py を先に流してください。" >&2; exit 1; }

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

fail=0
ok() { echo "  ok   $1"; }
ng() { echo "  FAIL $1"; fail=$((fail+1)); }
val() { $PSQL -tAc "$1" | tr -d '[:space:]'; }

$PSQL -f "$HERE/setup.sql" >/dev/null

echo "0) 先に申請フォームから1件来ている状態にする"
# 登録SQLが既存の申請を巻き込まないことを見るための下ごしらえ。
# 掲載する30件とは別の名前にしておく。
$PSQL >/dev/null <<'SQL'
insert into public.stars_spots (name, pref, city, lat, lon, submitter_hint)
values ('利用者からの申請', '長野県', '阿智村', 35.44, 137.68, 'someone-else');
SQL
ok "申請1件(pending)を置いた"

echo "1) 登録SQLがそのまま通ること"
if $PSQL -f "$SEED" >/dev/null 2>"$BASE/e1"; then ok "通った"; else ng "失敗: $(tail -3 "$BASE/e1")"; fi

echo "2) 30件入り、30件とも approved になること"
n=$(val "select count(*) from public.stars_spots where submitter_hint like 'seed-%';")
[ "$n" = "30" ] && ok "30件入った" || ng "$n 件しか入っていない"
a=$(val "select count(*) from public.stars_spots where submitter_hint like 'seed-%' and status='approved';")
[ "$a" = "30" ] && ok "30件とも approved" || ng "approved は $a 件"
p=$(val "select count(*) from public.stars_public_spots();")
[ "$p" = "30" ] && ok "公開RPCが返すのは30件" || ng "公開RPCが $p 件返す"

echo "3) 椿山森林公園が入らないこと"
t=$(val "select count(*) from public.stars_spots where name like '%椿山%';")
[ "$t" = "0" ] && ok "椿山森林公園は入っていない" || ng "椿山森林公園が $t 件入っている"

echo "4) 座標を取り直した3件が、候補JSONのとおりに入ること"
# 独立検証で座標の誤りが見つかり、取り直した3件。
# ここが1桁ずれても画面は正常に見えるので、機械で突き合わせるしかない。
for row in \
  "大山まきばみるくの里|35.3778565|133.5107365" \
  "大川山キャンプ場|34.1148979|133.9416574" \
  "輝北うわば公園キャンプ場|31.5936|130.827"
do
  IFS='|' read -r nm la lo <<<"$row"
  got=$(val "select lat::text || ',' || lon::text from public.stars_spots where name = '$nm';")
  [ "$got" = "$la,$lo" ] && ok "$nm $got" || ng "$nm は $got (期待 $la,$lo)"
done

# ここから先は「駄目な行の数が0」ではなく「良い行の数が30」で見る。
# 0件で数えると、1件も入っていないときに全部が通ってしまう
# (実際そうなった。登録が全滅しているのに 5) と 6) だけ緑になった)。
echo "5) 全件に「気をつけること」と出典が入ること"
c=$(val "select count(*) from public.stars_spots
         where submitter_hint like 'seed-%' and caution is not null and caution <> '';")
[ "$c" = "30" ] && ok "30件すべてに気をつけることがある" || ng "気をつけることがあるのは $c 件"
u=$(val "select count(*) from public.stars_spots
         where submitter_hint like 'seed-%' and source_url like 'https://%';")
[ "$u" = "30" ] && ok "30件すべてに https の出典がある" || ng "https の出典があるのは $u 件"

echo "6) region が引き金で埋まること(SQLには書いていない)"
r=$(val "select count(*) from public.stars_spots
         where submitter_hint like 'seed-%' and region is not null and region <> '';")
[ "$r" = "30" ] && ok "region が全件埋まった" || ng "region が埋まったのは $r 件"

echo "7) もう一度流しても増えないこと"
if $PSQL -f "$SEED" >/dev/null 2>"$BASE/e2"; then ok "2回目も通った"; else ng "2回目で失敗: $(tail -3 "$BASE/e2")"; fi
n2=$(val "select count(*) from public.stars_spots where submitter_hint like 'seed-%';")
[ "$n2" = "30" ] && ok "2回流しても30件のまま" || ng "2回目で $n2 件になった"

echo "8) 先に来ていた申請を巻き込まないこと"
s=$(val "select status from public.stars_spots where name = '利用者からの申請';")
[ "$s" = "pending" ] && ok "申請は pending のまま残っている" || ng "申請の状態が $s になった"

echo
if [ "$fail" -eq 0 ]; then
  echo "すべて通過"
else
  echo "$fail 件失敗" >&2
  exit 1
fi
