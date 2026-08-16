#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
公開対象30件を stars_spots へ登録するSQLを、候補JSONから機械的に作る。

なぜ生成するのか:
  30件×十数列を手で書き写すと、必ずどこかで1文字ずれる。
  ずれても誰も気づけない(座標が数十m違っても画面は正常に見える)。
  正本は scripts/stars/spot-candidates.json のほうで、
  このSQLはそこから毎回作り直す。

何を作るか(2つ。混ぜない):
  scripts/stars/generated/seed-spots.sql   … 登録する
    Supabase の SQL Editor に貼って1回実行する。
    begin 〜 commit で囲んであり、途中で失敗すれば何も残らない。
    何度実行しても重複しない(既にある pref+name は入れない)。
  scripts/stars/generated/verify-spots.sql … 入ったか確かめる(読み取りだけ)

  以前は1つのファイルにまとめていた。SQL エディタは最後の文の結果しか
  出さないので、貼った人からは「案内されていないSQLが出てきて、
  最後の1行だけが表示された」ように見える。分けて渡す。

対象:
  verdict が「条件付き可」のもの(= Hiroさんが公開すると決めた30件)。
  椿山森林公園は verdict が「除外」なので入らない。

使い方:
  python3 scripts/stars/build_seed_sql.py
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "generated")
OUT = os.path.join(OUT_DIR, "seed-spots.sql")
# 確認は別のファイルにする。
# 登録と確認を1つのファイルにまとめていたが、Supabase の SQL エディタは
# 最後の文の結果しか出さない。貼った人には「案内されていないSQLが出てきて、
# 最後の1行だけが表示された」と見える。手順の説明で埋めるのではなく、
# 分けて渡す。
OUT_CHECK = os.path.join(OUT_DIR, "verify-spots.sql")

PUBLISH_VERDICT = "条件付き可"

# stars_spots の check 制約(setup.sql と同じ値。ずれたら気づけるよう再掲する)
LIMITS = {
    "name": (2, 60), "name_kana": (0, 80), "city": (0, 40),
    "access": (0, 400), "facilities": (0, 400), "note": (0, 1000),
    "caution": (0, 500), "source_url": (0, 300),
}
BOUNDS = {"south": 20, "north": 46, "west": 122, "east": 154}


def q(v):
    """SQL の文字列リテラル。None は NULL。"""
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def pick_source_url(spot):
    """
    source_url に入れる1本を選ぶ。

    公式(自治体・施設運営者・公式観光組織)を優先する。
    詳細ページからは1本しかリンクしないので、
    利用者が最初に当たるべきものを置く。
    """
    srcs = spot.get("sources") or []
    official = [s for s in srcs if s.get("kind") == "公式" and str(s.get("url", "")).startswith("https://")]
    if official:
        return official[0]["url"]
    https = [s for s in srcs if str(s.get("url", "")).startswith("https://")]
    return https[0]["url"] if https else None


def check(spot, url):
    """setup.sql の制約に反するものを、SQLを作る前に見つける"""
    bad = []
    for col, val in [
        ("name", spot["name"]), ("city", spot.get("city")),
        ("access", spot.get("access")), ("note", spot.get("note")),
        ("caution", spot.get("caution")), ("source_url", url),
    ]:
        if val is None:
            continue
        lo, hi = LIMITS[col]
        n = len(str(val))
        if n > hi or n < lo:
            bad.append(f"{col} が {n} 文字({lo}〜{hi})")
    lat, lon = spot["lat"], spot["lon"]
    if not (BOUNDS["south"] <= lat <= BOUNDS["north"] and BOUNDS["west"] <= lon <= BOUNDS["east"]):
        bad.append(f"座標が対象範囲の外 ({lat}, {lon})")
    if url and not url.startswith("https://"):
        bad.append("source_url が https でない")
    return bad


data = json.load(io.open(os.path.join(HERE, "spot-candidates.json"), encoding="utf-8"))
selection = json.load(io.open(os.path.join(HERE, "selection-2026-08-15.json"), encoding="utf-8"))

# submitter_hint に使う印。
#
# 表の制約が 8〜64文字なので、'seed-01' のような短いものは入らない
# (使い捨てのデータベースで流して初めて分かった。本番で気づいていたら、
#  Hiroさんが SQL エディタでエラーだけを見ることになっていた)。
# 決定日を混ぜてあるのは、あとから「どの回で入れた行か」を辿れるようにするため。
SEED_TAG = "seed-" + selection["決定日"] + "-"
spots = [s for s in data["spots"] if s["verdict"] == PUBLISH_VERDICT]
spots.sort(key=lambda s: (s["pref"], s["name"]))

# 椿山が紛れ込んでいないこと(除外したはずのものを入れない)
for s in spots:
    if "椿山" in s["name"]:
        raise SystemExit("椿山森林公園が公開対象に入っています。verdict を確かめてください。")

problems = []
rows = []
for i, s in enumerate(spots, start=1):
    url = pick_source_url(s)
    bad = check(s, url)
    if bad:
        problems.append(f"{s['pref']} {s['name']}: " + " / ".join(bad))
    rows.append((s, url, i))

# submitter_hint は 8〜64文字。ここを外すと1件目で止まる。
if not (8 <= len(SEED_TAG) + 2 <= 64):
    problems.append(f"submitter_hint が {len(SEED_TAG) + 2} 文字(8〜64)")

if problems:
    print("制約に反するデータがあります。SQLは作りません:", file=sys.stderr)
    for p in problems:
        print("  ・" + p, file=sys.stderr)
    raise SystemExit(1)

values = []
for s, url, i in rows:
    values.append(
        "    (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
        % (
            q(s["pref"]), q(s["name"]), q(s.get("city")),
            repr(s["lat"]), repr(s["lon"]),
            q(s.get("access")), q(s.get("note")), q(s.get("caution")), q(url),
        )
    )

VALUES_SQL = ",\n".join(values)
APPROVE_SQL = ",\n".join(
    "    (%s, %s)" % (q(s["pref"]), q(s["name"])) for s, _, _ in rows
)

head = f"""-- =============================================================
-- 掲載スポット {len(rows)}件の登録
--
-- これは scripts/stars/spot-candidates.json から機械的に作ったもの。
-- 手で書き換えないこと。直すときは候補JSONを直して
--   python3 scripts/stars/build_seed_sql.py
-- で作り直す。
--
-- 作り方の決まり:
--   ・begin 〜 commit で囲む。途中で失敗すれば何も残らない
--   ・既にある pref+name は入れない。何度実行しても重複しない
--   ・既存のデータを消さない(delete も truncate も無い)
--   ・approved にするのは、ここに並ぶ{len(rows)}件だけ
--   ・管理トークンも service_role キーも書かない
--     (SQL Editor は既に権限を持っているので、承認RPCを通す必要がない)
--
-- なぜ status を直に書き換えるのか:
--   登録の引き金(check_stars_spot_insert)が、入ってくる行を必ず
--   status='pending' にする。申請フォームから承認済みを送り込めなくするため。
--   そのぶん、掲載する側は入れたあとに承認へ移す必要がある。
--
-- なぜ submitter_hint が1件ずつ違うのか:
--   同じ引き金が「同じ端末は24時間で3件まで」を見ている。
--   同じ値を{len(rows)}回使うと4件目で止まる。
--   これは利用者の連投を抑えるためのもので、掲載の登録を止める意図ではない。
--   1件ずつ違う値にして素通りさせる({SEED_TAG}01 〜 {SEED_TAG}{len(rows):02d})。
--   日付を挟んであるのは、あとから「どの回で入れた行か」を辿れるようにするため
--   (この列には 8文字以上という決まりもある)。
--
-- region 列は書いていない。引き金が pref から引いて埋める。
-- =============================================================

begin;

-- 入れるもの。ここに並ぶ{len(rows)}件がすべて。
with v (pref, name, city, lat, lon, access, note, caution, source_url) as (
  values
{VALUES_SQL}
),
"""

body = f"""-- まだ入っていないものだけを入れる(pref と name で見る)。
-- 2回目以降に流しても、ここが0件になるだけで何も起きない。
ins as (
  insert into public.stars_spots
    (name, pref, city, lat, lon, access, note, caution, source_url, submitter_hint)
  select v.name, v.pref, v.city, v.lat, v.lon, v.access, v.note, v.caution, v.source_url,
         '{SEED_TAG}' || lpad((row_number() over (order by v.pref, v.name))::text, 2, '0')
    from v
   where not exists (
     select 1 from public.stars_spots t
      where t.pref = v.pref and t.name = v.name
   )
  returning spot_id
)
select count(*) as 今回入れた件数 from ins;

-- 承認する。対象はこの{len(rows)}件だけ。
-- ここに無い行の status には触れない。
with v (pref, name) as (
  values
{APPROVE_SQL}
)
update public.stars_spots t
   set status = 'approved',
       approved_at = coalesce(t.approved_at, now()),
       reject_reason = null
  from v
 where t.pref = v.pref
   and t.name = v.name
   and t.status is distinct from 'approved';

commit;
"""

"""
確認用のSQL。

作りの決まり:
  ・文は1つだけ。SQL エディタが最後の結果しか出さないので、
    複数に分けると前のほうが見えなくなる。
  ・合っているかどうかを、こちらが判定して出す。
    値を見比べる作業を人にさせない。
  ・列は3つ、値は短い数字だけ。iPhone の画面で横に切れないようにする。
  ・読み取りだけ。何も書き換えない。
"""
# 座標を取り直した3件。ここが1桁ずれても画面は正常に見えるので機械で見る。
COORD_CHECKS = [("大山まきばみるくの里", "35.3778565", "133.5107365"),
                ("大川山キャンプ場", "34.1148979", "133.9416574"),
                ("輝北うわば公園キャンプ場", "31.5936", "130.827")]
COORD_SQL = " or ".join(
    "(name = %s and lat::text = %s and lon::text = %s)" % (q(n), q(la), q(lo))
    for n, la, lo in COORD_CHECKS
)

check_sql = f"""-- =============================================================
-- 登録できたかの確認({len(rows)}件)
--
-- 読み取りだけ。何も書き換えない。
-- 全部まとめて貼って実行すると、確かめることが1つの表に出る。
-- 判定の列がすべて ok なら、それで終わり。
--
-- これは scripts/stars/spot-candidates.json から機械的に作ったもの。
-- 手で書き換えないこと。
-- =============================================================

select t.項目, t.結果, case when t.結果 = t.期待 then 'ok' else 'NG' end as 判定
from (values
  (1, '公開される件数',
      (select count(*)::text from public.stars_public_spots()), '{len(rows)}'),
  (2, '承認済みの件数',
      (select count(*)::text from public.stars_spots where status = 'approved'), '{len(rows)}'),
  (3, '椿山森林公園(入っていたら誤り)',
      (select count(*)::text from public.stars_public_spots() where name like '%椿山%'), '0'),
  (4, '気をつけることが入っている件数',
      (select count(*)::text from public.stars_public_spots()
        where caution is not null and caution <> ''), '{len(rows)}'),
  (5, '出典が https の件数',
      (select count(*)::text from public.stars_public_spots()
        where source_url like 'https://%'), '{len(rows)}'),
  (6, '座標を取り直した3件が候補どおり',
      (select count(*)::text from public.stars_public_spots()
        where {COORD_SQL}), '{len(COORD_CHECKS)}')
) as t(n, 項目, 結果, 期待)
order by t.n;
"""

os.makedirs(OUT_DIR, exist_ok=True)
out = head + body
io.open(OUT, "w", encoding="utf-8").write(out)
io.open(OUT_CHECK, "w", encoding="utf-8").write(check_sql)
print("%s  %d行 / %d件" % (OUT, out.count("\n") + 1, len(rows)))
print("%s  %d行 (確認用・読み取りだけ)" % (OUT_CHECK, check_sql.count("\n") + 1))
