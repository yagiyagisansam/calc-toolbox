# 申し送り: 今夜のオススメ星見スポット

最終更新: 2026-08-16 / 対象: `quick-calc.site/stars/`

このファイルは**次のセッションが最初に読むもの**。
リポジトリ全体の決まりは `CLAUDE.md`、外部記憶Vaultは `claude-memory` を参照。

---

## 1. いまどうなっているか

**公開済み**。https://quick-calc.site/stars/ が稼働している。掲載30件・30都道府県。

| ブランチ | 中身 |
|---|---|
| `main` | `62323e3`（Codex の PR #13〜#16 まで） |
| `gh-pages` | `main` と同一 |
| `claude/stargazing-spot-site-uijopc` | `497271d`（**未マージの修正3件あり。下の「2」を参照**） |

掲載スポットは Supabase にあり、サイトは開くたびに直接読む。
**スポットを増やす・直すときは SQL で承認するだけ。サイトの再公開は要らない。**

---

## 2. すぐ対応が要ること（優先順）

### ★1. Supabase の差分SQLが未適用かもしれない（公開中の申請フォームが壊れている可能性）

Codex の PR #15 は、申請フォームから座標を送らない方式に変えた。
DB 側の受け入れも変える必要があり、そのSQLが用意されている。

```
scripts/stars/generated/migrate-spot-columns.sql
```

**Codex の指定した公開順は「PR→main → SQL適用 → main→gh-pages」だったが、
gh-pages は既に更新済み**。SQLが未適用なら、いま申請フォームから送っても
DB に拒否される（`lat` / `lon` が not null のまま）。

- 適用済みかどうかは anon 権限では確認できない（`stars_spots` に SELECT 権限が無いため）
- **Hiroさんに「このSQLを流したか」を確認すること**
- 未適用なら Supabase SQL Editor で1回実行してもらう
- 渡すときは [[rules/handover-one-purpose-one-paste]] に従う（登録用と確認用を混ぜない）

### ★2. 未マージの修正3件（`claude/stargazing-spot-site-uijopc` の `497271d`）

Codex の環境には Playwright が無く、**追加された画面検査は未実行のまま main に入っていた**。
こちらで流したところ3件落ちたので直してある。**まだ main に入れていない。**

1. **幅390pxで予報のお知らせの閉じるボタンを押せない**
   凡例（左下・最大260px）とお知らせ（右下・最大360px）が390pxに収まらず、
   `z-index` が同じ2なのでお知らせが凡例の下に潜っていた。
   **iPhone では出たお知らせを消せない。** → `z-index: 4` に。
2. **閉じたお知らせが同じセッションで再び出る**（`stars/notice.js`）
   `show()` が閉じる処理を1度しか結びつけないのに、その時点の `storageKey` を
   関数の中に閉じ込めていた。いまは要素に持たせ、押した時点で読む。
   本番の呼び出しは key が1種類なので表面化していないが、2種類目を足すと起きる。
3. **地図ページの meta description に「観測スポット」が無い**
   狙う検索語は「流星群 観測スポット」。語順を直して1つながりにした。

→ PR を作って main へ入れ、`git push origin main:gh-pages` で公開する。

### ★3. 出典が個人ブログ等のみの7件

竜神大吊橋 第二駐車場 / 滝沢ダム ループ橋 駐車場 / 刑部岬 展望館 /
真脇遺跡公園 / 鶴姫公園 / 鏡山展望台 / 辺戸岬

詳細ページの「参考」欄に出る。**DBの更新だけで済む**（サイトの再公開は不要）。

---

## 3. あとで対応すること

1. 保留7件・除外10件の再検討。47都道府県のうち17県が空欄
2. 地名索引の補完（美ヶ原・洞爺湖・四国カルスト・野辺山）。ID/fixture/kind での検証つき
3. スポット名の canonicalName + aliases[] 対応
4. リポジトリの公開/非公開（下の「7」を参照）

---

## 4. 絶対に守ること（Hiroさんからの指示・恒久）

| # | 決まり |
|---|---|
| 1 | **公開は必ず `main` 経由**。`gh-pages` へ直接 push しない（次に main から公開したとき巻き戻る。実際に起きかけた） |
| 2 | 開発は `claude/stargazing-spot-site-uijopc` だけ。他のブランチへ push しない |
| 3 | **Supabase への書き込みをこちらで行わない**。SQLを渡してHiroさんに実行してもらう |
| 4 | `service_role` キー・管理トークンをリポジトリやログへ書かない |
| 5 | 座標を推測で埋めない。確定できないものは未確定のまま残す |
| 6 | Open-Meteo を直接叩かない（**(地点数)×(1日の更新回数) ≦ 10,000**。いま552地点×日8回=4,416） |
| 7 | 第三者サイトを繰り返し取得しない（1サイト数回まで） |
| 8 | iframe をセキュリティ境界として説明しない |
| 9 | **サイトに「私（Hiroさん）への説明」を書かない**。訪問者が知りたいのは「どこで星が見えるか」。根拠情報はSEOに要る最小限だけ |
| 10 | **Hiroさんに渡すSQL・コマンドは1目的1ファイル・自己判定つき（ok/NG）**。渡す前に使い捨て環境で実際に流す |
| 11 | 呼び名は「Hiroさん」。日本語・結論先行。**主環境はiPhone**（PC前提の手順は明示的に区別する） |

---

## 5. 構成（どこに何があるか）

### 画面
| 場所 | 中身 |
|---|---|
| `stars/index.html` | 地図。色分けラスタ＋移動できる予報パネル＋凡例＋ピン |
| `stars/list.html` | 一覧。中心＋半径10〜100kmで絞り、星見レベル順にランキング |
| `stars/spot.html` | 1スポットの時間別予報（noindex） |
| `stars/submit.html` | 申請フォーム（ログイン不要・**座標のピン打ちは求めない**） |
| `stars/intro.html` | サイトの目的・参加方法（Codex が追加） |
| `stars/about.html` | 出典とライセンスのみ（**計算方法は書かない**） |
| `stars/pick.html` | 地図を枠で読み込むためのページ（robots.txt で Disallow） |

### 計算・通信
| 場所 | 中身 |
|---|---|
| `stars/sky.js` | 太陽と月の位置・月齢・天文薄明からの「暗い時間帯」 |
| `stars/score.js` | 星見レベル(0〜100)。しきい値は CONFIG に集約 |
| `stars/lp.js` `map.js` `net.js` `app.js` `palette.js` | 光害ラスタ / 地図と描画 / 通信 / 画面 / 配色 |
| `stars/nav.js` `panel.js` `notice.js` | サイドメニュー / 移動できるパネル / 閉じられるお知らせ |

### スクリプト
| 場所 | 中身 |
|---|---|
| `scripts/stars/spot-candidates.json` | **掲載候補の正本**。採否・座標・出典・注意事項 |
| `scripts/stars/build_seed_sql.py` | 候補JSONから登録SQLと確認SQLを生成 |
| `scripts/stars/generated/seed-spots.sql` | 登録する（begin〜commit の1回きり） |
| `scripts/stars/generated/verify-spots.sql` | 入ったか確かめる（読み取りのみ・1文だけ） |
| `scripts/stars/generated/migrate-spot-columns.sql` | **★未適用かもしれない差分SQL** |
| `scripts/stars/setup.sql` `ops.md` | DBの正本と承認手順 |
| `scripts/stars/weather-cache.sql` | 天気のサーバー側キャッシュ(pg_cron/pg_net) |
| `scripts/stars/build_lp.mjs` | 光害ラスタの生成（年1回程度） |
| `scripts/stars/harness.mjs` | 検証の共通土台（ブラウザ・静的配信・中継） |

---

## 6. 検証のしかた

```bash
node scripts/run_tests.mjs              # 全ツール+stars(1301件)
node scripts/stars/check_candidates.mjs # 掲載候補のつじつま(973件)
node scripts/stars/sky.test.mjs         # 月と夜の判定(196件)
node scripts/stars/net.test.mjs         # 天気キャッシュの扱い(37件)
node scripts/stars/notice.test.mjs      # 閉じられるお知らせ(4件)
node scripts/stars/places.test.mjs      # 地名の索引と検索(55件)
node scripts/stars/glow.test.mjs        # 大気散乱
node scripts/stars/land_grid.mjs        # 取りに行く地点の検査

node scripts/stars/verify.mjs           # 決め打ちの5件で作りを検算
node scripts/stars/verify_live.mjs      # 本番データで壊れていないか(読み取りのみ)
for w in 390 768 1280; do node scripts/stars/verify.mjs --width=$w; done

bash scripts/stars/pgtest.sh            # 天気キャッシュのSQL
bash scripts/stars/setup.test.sh        # setup.sql が新規・更新どちらでも通るか
bash scripts/stars/migrate.test.sh      # 差分SQLがいまの本番の版に当たるか
bash scripts/stars/seed.test.sh         # 登録SQLと確認SQLが実際に通るか
```

**ブラウザ検証を省かないこと。** Codex は Playwright が無いまま検査項目だけ追加し、
その3件が実際に落ちた（上の「2」）。`verify.mjs` は幅を変えて3通り流す。

この環境ではブラウザが外に出られない（Node は出られる）。
`verify.mjs --relay` で中継し、`--live` を足すと Supabase も中継する。
`verify_live.mjs` は常に中継する。

---

## 7. 次にやりたいこと: 新しいプライベートリポジトリへの移行

Hiroさんの意向。**着手前に「8. 移行の落とし穴」を必ず読むこと。**

現状の事実（2026-08-16 時点で確認済み）:

- `yagiyagisansam/calc-toolbox` は **公開（public）**。認証なしのAPIアクセスが HTTP 200 で通る
- 配信は GitHub Pages（`gh-pages` ブランチ）
- 独自ドメイン `quick-calc.site` を使用
- `stars/` 以外に65個の計算ツールが同居している

---

## 8. 移行の落とし穴（先に潰すこと）

| # | 落とし穴 |
|---|---|
| 1 | **GitHub Pages を私有リポジトリから配信するには GitHub Pro（有料）が要る**。無料のまま非公開にすると配信が止まる |
| 2 | **`stars/` だけ移すとサイトが割れる**。`tools/poll/config.js`（Supabase接続情報）、`../contact.html`、`../disclaimer.html`、`../`（トップ）に依存している |
| 3 | **独自ドメインの再設定**。新リポジトリで `CNAME` と DNS を張り替える間、サイトが落ちる |
| 4 | **公開URLが変わると SEO がリセットされる**。同じドメインを維持すれば影響しない |
| 5 | **`git log` の履歴**。`--depth 1` でコピーすると、なぜそう作ったかの記録が全部消える |
| 6 | **Supabase の anon キーはリポジトリに書いてある**（`tools/poll/config.js`）。これは公開前提の設計なので問題ないが、`service_role` キーが混ざっていないことは移行時に確認する |
| 7 | **非公開にしても `score.js` は隠せない**。ブラウザで動く以上、開発者ツールから必ず読める |

---

## 9. 記録済みの失敗（同じ轍を踏まないこと）

外部記憶Vault `claude-memory` にある。

- `mistakes/claimed-deploy-without-live-check` — main へのマージだけでは公開されない。`curl` で実体を確認してから報告する
- `mistakes/mixed-registration-and-verification-sql` — 登録SQLと確認SQLを1ファイルに混ぜて渡した
- `mistakes/zero-bad-rows-check-passes-when-empty` — 「異常0件」で数える検査は、全滅したとき緑になる
- `mistakes/batch-steps-instead-of-one-by-one` — 複雑な手順を長文一括で提示した
