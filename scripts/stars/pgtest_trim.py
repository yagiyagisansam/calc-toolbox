#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
weather-cache.sql を、使い捨てのデータベースで流せる形に削る。

本番向けの2か所だけを外す:
  ⑦ 定期実行(cron の登録)      … テストでは要らない
  ⑨ 今すぐ1回ぶんだけ試す      … 上流へ本当に投げてしまう

あわせて、この環境に無い拡張の作成を落とし、
テスト中に時刻を差し替えられるよう名前の解決順を変える。

pgtest.sh から呼ぶ。新しい版と古い版の両方を同じ手順で削るために、
スクリプトの中に埋め込まず独立したファイルにしてある
(埋め込んだままヒアドキュメントを入れ子にして壊した)。

使い方: python3 pgtest_trim.py <入力.sql> <出力.sql>
"""
import io
import sys

src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding="utf-8").read()

cut = s.index("-- ---- ⑦ 定期実行 ----")
grid = s.index("-- ---- ⑧ 取りに行く地点を組み立てる ----")
end = s.index("-- ---- ⑨ 今すぐ1回ぶんだけ試す ----")
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
