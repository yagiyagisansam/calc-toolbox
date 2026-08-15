#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本番へ流す「差分だけ」のSQLを、正本のファイルから切り出して作る。

なぜ切り出すのか:
  weather-cache.sql は816行ある。iPhone の SQL エディタに毎回そのまま貼るのは
  現実的ではないし、貼り損ねる余地も増える。
  かといって手で書き写すと、正本とずれたものを本番に流すことになる。
  そこで、正本から機械的に切り出す。中身は必ず正本と同じになる。

切り出す範囲は「見出しの間」で指定する。行番号で指定するとファイルを
編集するたびにずれるため。

使い方:
  python3 scripts/stars/build_migration.py
    → scripts/stars/generated/migrate-weather-cycle.sql
"""
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "generated")


def slice_between(text, start_head, end_head):
    a = text.index(start_head)
    b = text.index(end_head)
    if b <= a:
        raise SystemExit("見出しの順番が想定と違います")
    return text[a:b]


def build_weather_cycle():
    src = io.open(os.path.join(HERE, "weather-cache.sql"), encoding="utf-8").read()

    body = slice_between(
        src,
        "-- ---- ④ 取得中の要求を覚えておく場所 ----",
        "-- ---- ⑥-1 取り直しに使ってよい枠(1日ぶん) ----",
    )

    head = """-- =============================================================
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

"""

    tail = """

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
"""

    out = head + body + tail
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "migrate-weather-cycle.sql")
    io.open(path, "w", encoding="utf-8").write(out)
    return path, out


def build_spot_columns():
    src = io.open(os.path.join(HERE, "setup.sql"), encoding="utf-8").read()

    # 列の追加と、返す列が変わった2つの関数だけを切り出す
    alter = slice_between(
        src,
        "/*\n * 既に動いている環境向け(caution と city を後から足したため)。",
        "create index if not exists stars_spots_status_region_idx",
    )

    # 申請の検証(city の空白をならす処理が入った)も一緒に流す
    trigger = slice_between(
        src,
        "-- ---- ③ 申請内容の検証(CAPTCHA の代わり) ----",
        "-- ---- ④ 公開用(承認済みだけを返す) ----",
    )
    grant = "grant insert (name, name_kana, pref, city, lat, lon, elevation_m, access, facilities, note, caution, source_url, submitter_hint)\n  on public.stars_spots to anon;\n"
    if grant not in src:
        raise SystemExit("grant 文が想定と違います")

    # 権限付与まで含めて切り出す(関数を作り直すと権限も消えるため)
    public_fn = slice_between(
        src,
        "/*\n * 返す列を増やしたときは、create or replace では置き換えられない",
        "-- ---- ⑤ 承認作業(管理用トークンが要る) ----",
    )

    # 承認作業の一覧も、返す列が変わったので作り直す
    ops_fn = slice_between(
        src,
        "-- 同上。承認画面に出す列を増やしたので、先に落としてから作り直す。",
        "-- 承認\ncreate or replace function public.stars_ops_approve",
    )
    revoke_ops = "revoke all on function public.stars_ops_pending(text, int) from public, anon, authenticated;\n"
    if revoke_ops not in src:
        raise SystemExit("stars_ops_pending の revoke が想定と違います")


    head = """-- =============================================================
-- スポット: 市区町村(city)と気をつけること(caution)を足す
--
-- これは scripts/stars/setup.sql の変更部分だけを切り出したもの。
-- Supabase の SQL Editor に貼って1回実行する。何度実行しても壊れない。
--
-- なぜ必要か:
--   申請フォームはこの2つを送るようになっている。列が無いと
--   「column "city" of relation "stars_spots" does not exist」で
--   申請そのものが失敗する(利用者全員が投稿できない)。
--   また、承認作業でこの2つが見えないと、何が書かれたのか確認できない。
--
-- 注意:
--   返す列が変わる関数は create or replace では置き換えられないので、
--   先に drop してから作り直している。順番を入れ替えないこと。
--
--   全体が begin 〜 commit で囲んである。途中で失敗したら何も残らない。
--   「列だけ足って制約が付いていない」という中途半端な状態を作らないため
--   (まっさらな環境と受け付ける値が違う DB が生まれる)。
-- =============================================================

begin;

"""

    tail = """
commit;

-- ---- 確認 ----
-- 列が増えたか
select column_name as 列
from information_schema.columns
where table_name = 'stars_spots' and column_name in ('city', 'caution')
order by column_name;

-- 制約が付いたか(2行出れば成功)
select conname as 制約
from pg_constraint
where conname in ('stars_spots_city_check', 'stars_spots_caution_check')
order by conname;

-- 公開用の関数が新しい列を返すか(空でも列名が出れば成功)
select * from public.stars_public_spots() limit 1;
"""

    out = (
        head + alter + grant + "\n\n" + trigger + public_fn + ops_fn + revoke_ops + tail
    )
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "migrate-spot-columns.sql")
    io.open(path, "w", encoding="utf-8").write(out)
    return path, out


for builder in (build_weather_cycle, build_spot_columns):
    path, text = builder()
    print("%s  %d行" % (path, text.count("\n") + 1))
