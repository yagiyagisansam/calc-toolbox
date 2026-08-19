# 申し送り: 今夜のオススメ星見スポット

最終更新: 2026-08-16 / 対象: `quick-calc.site/stars/`

このファイルは**次のセッションが最初に読むもの**。
リポジトリ全体の決まりは `CLAUDE.md`、外部記憶Vaultは `claude-memory` を参照。

---

## 1. 次のセッションでやること

**`calc-toolbox` を新しいプライベートリポジトリへ丸ごと移す。**

Hiroさんの決定（2026-08-16）。
「GitHub上でソースを読まれることをなくせるのは大きなメリット」とのご判断。
デメリット（費用・移行作業のリスク・`score.js` は隠せないこと）は説明済みで、
**すべて了解のうえで進める**。GitHub の有料会員であることも確認済み。

移行の手順と落とし穴は「**7. 移行の進め方**」に書いた。**着手前に必ず読むこと。**

---

## 2. いまどうなっているか

**公開済み**。https://quick-calc.site/stars/ が稼働している。掲載30件・30都道府県。

| ブランチ | 中身 |
|---|---|
| `main` | `08080d4` |
| `gh-pages` | `main` と同一の中身（公開記録のマージコミットぶんだけハッシュが違う） |
| `claude/stargazing-spot-site-uijopc` | `main` と同じ。未マージの作業なし |

Supabase の差分SQL（`migrate-spot-columns.sql`）は **Hiroさんが実行済み**（2026-08-16 確認）。
申請フォームは座標なしでも受け付けられる状態になっている。

掲載スポットは Supabase にあり、サイトは開くたびに直接読む。
**スポットを増やす・直すときは SQL で承認するだけ。サイトの再公開は要らない。**

---

## 3. 残っている作業

**掲載30件のうち7件は、出典が個人ブログや情報サイトのみ**（竜神大吊橋 第二駐車場 /
滝沢ダム ループ橋 駐車場 / 刑部岬 展望館 / 真脇遺跡公園 / 鶴姫公園 / 鏡山展望台 / 辺戸岬）。
詳細ページの「参考」欄に出る。
**Hiroさんの判断で、差し替えは不要（2026-08-16）。蒸し返さないこと。**

1. 保留7件・除外10件の再検討。47都道府県のうち17県が空欄
2. 地名索引の補完（美ヶ原・洞爺湖・四国カルスト・野辺山）。ID/fixture/kind での検証つき
3. スポット名の canonicalName + aliases[] 対応
4. 座標が未確定の申請が来たときの承認運用（`stars_ops_set_location` → `stars_ops_approve`）。手順は `scripts/stars/ops.md`

---

## 4. 絶対に守ること（Hiroさんからの指示・恒久）

| # | 決まり |
|---|---|
| 1 | **公開は必ず `main` 経由**。`gh-pages` へ直接 push しない（次に main から公開したとき巻き戻る。実際に起きかけた） |
| 2 | 開発は指定されたブランチだけ。他のブランチへ push しない |
| 3 | **Supabase への書き込みをこちらで行わない**。SQLを渡してHiroさんに実行してもらう |
| 4 | `service_role` キー・管理トークンをリポジトリやログへ書かない |
| 5 | 座標を推測で埋めない。確定できないものは未確定のまま残す |
| 6 | Open-Meteo を直接叩かない（**(地点数)×(1日の更新回数) ≦ 10,000**。いま552地点×日8回=4,416） |
| 7 | 第三者サイトを繰り返し取得しない（1サイト数回まで） |
| 8 | iframe をセキュリティ境界として説明しない |
| 9 | **サイトに「Hiroさんへの説明」を書かない**。訪問者が知りたいのは「どこで星が見えるか」。根拠情報はSEOとライセンス表示に要る最小限だけ |
| 10 | **Hiroさんに渡すSQL・コマンドは1目的1ファイル・自己判定つき（ok/NG）**。渡す前に使い捨て環境で実際に流す |
| 11 | 呼び名は「Hiroさん」。日本語・結論先行。**主環境はiPhone**（PC前提の手順は明示的に区別する） |
| 12 | **ブラウザ検証を省かない。** Codex が Playwright 無しで検査項目だけ追加し、その3件が実際に落ちた（下の「6」） |

---

## 5. 構成（どこに何があるか）

### 画面
| 場所 | 中身 |
|---|---|
| `stars/index.html` | 地図。色分けラスタ＋移動できる予報パネル＋凡例＋ピン |
| `stars/list.html` | 一覧。中心＋半径10〜100kmで絞り、星見レベル順にランキング |
| `stars/spot.html` | 1スポットの時間別予報（noindex） |
| `stars/submit.html` | 申請フォーム（ログイン不要・**座標のピン打ちは求めない**） |
| `stars/intro.html` | サイトの目的・参加方法 |
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
| `scripts/stars/generated/migrate-spot-columns.sql` | 適用済み（2026-08-16） |
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

**幅を変えて3通り流すこと。** Codex の PR #13〜#16 で追加された検査は、
Codex 側に Playwright が無く一度も実行されないまま main に入り、3件落ちた。

- 幅390pxで予報のお知らせの閉じるボタンが凡例に隠れて押せない（iPhoneで消せない）
- 閉じたお知らせが同じセッションで再表示される（`notice.js` のキーの取り違え）
- 地図ページの meta description に「観測スポット」が入っていない

いずれも修正済み（PR #17）。**同じ取りこぼしを繰り返さないこと。**

この環境ではブラウザが外に出られない（Node は出られる）。
`verify.mjs --relay` で中継し、`--live` を足すと Supabase も中継する。
`verify_live.mjs` は常に中継する。

---

## 7. 移行の進め方（次のセッションの本題）

### 前提（確認済みの事実）

- `yagiyagisansam/calc-toolbox` は現在 **公開（public）**
- 配信は GitHub Pages（`gh-pages` ブランチ）、独自ドメイン `quick-calc.site`（ルートに `CNAME`）
- Hiroさんは **GitHub の有料会員**。私有リポジトリからの Pages 配信が可能
- GitHub Actions は**使っていない**（`.github/workflows` が無い）ので、実行時間の枠は関係ない
- `service_role` キーはリポジトリに入っていない（`tools/poll/config.js` にあるのは注意書きのコメントだけ。実際の値は公開前提の `anon` キー）

### 先に確認すること: そもそも移行が要るか

Hiroさんの目的は「**GitHub上でソースを読まれることをなくす**」こと。
それだけなら、**いまの `calc-toolbox` の公開設定を「非公開」へ切り替えるだけ**で足りる。

| | 新リポジトリへ移行 | いまのリポジトリを非公開にするだけ |
|---|---|---|
| 目的の達成 | ○（旧リポジトリも非公開にすれば） | ○ |
| サイトが落ちる時間 | 数分〜数時間（DNS切替） | **なし** |
| DNS・CNAME の作業 | 要 | **不要** |
| 履歴のコピー | 要 | **不要** |
| 他ツールへの影響 | 移行漏れのリスクあり | **なし** |
| 費用 | 有料プラン（加入済み） | 同じ |

Pages は有料プランなら私有リポジトリからも配信でき、**公開サイト自体は今までどおり**
誰でも見られる。非公開になるのはリポジトリ（ソース）だけ。

**新しいリポジトリを作りたい別の理由**（履歴を切りたい、stars を他のツールと分けたい等）が
あるなら移行する。無いなら、切り替えるだけのほうが安全で速い。
**着手前にHiroさんへ確認すること。**

### 決まっている方針

1. **`stars/` だけを切り出さない。65個の計算ツールごと丸ごと移す。**
   `stars/` は `../tools/poll/config.js`（Supabase接続情報）、`../contact.html`、
   `../disclaimer.html`、`../privacy.html`、`../shared/style.css` に依存している。
2. **ドメイン `quick-calc.site` はそのまま維持する。** URLが変わるとSEOがリセットされる。
3. **履歴を持っていく。** 浅いコピーにしない（`--depth 1` を使わない）。
   「なぜそう作ったか」の記録が全部消える。

### 手順の案（Hiroさんの確認を取ってから実行すること）

1. 新しい**プライベート**リポジトリを作る（名前はHiroさんに決めてもらう）
2. `git clone --mirror` で全ブランチ・全履歴を取り、新リポジトリへ push
3. 新リポジトリで GitHub Pages を有効化（配信元 `gh-pages`）
4. `CNAME`（`quick-calc.site`）を新リポジトリ側で設定
5. **旧リポジトリの Pages 設定を無効化**してから、DNS を新しい側へ向ける
   （両方が同じドメインを主張すると、GitHub 側で取り合いになる）
6. `curl https://quick-calc.site/stars/` で実体を確認してから「移行済み」と報告
   → [[mistakes/claimed-deploy-without-live-check]]

### 旧リポジトリ `calc-toolbox` の扱い（★着手前に確認すること）

**削除しない。** 他のツールで使っているため、消すことはありえない（Hiroさんの指示）。

ただし、**旧リポジトリが公開のまま残ると、移行の目的が果たせない。**
新しい私有リポジトリを作っても、同じソースが `calc-toolbox` 側に公開で残っていれば、
`score.js` は GitHub からそのまま読める。履歴にも残っているので、
ファイルを消すだけでは足りない。

したがって、次のどちらかをHiroさんに確認してから移行を実行すること。

- **A. 旧リポジトリも非公開へ切り替える**（削除はしない）。これで目的が果たせる
- **B. 旧リポジトリは公開のまま残す**。この場合、**移行しても GitHub からソースは読めるまま**
  なので、移行の効果はほぼ無い。移行そのものを見直したほうがよい

**確認を取らずに移行を進めないこと。** Bのまま作業すると、費用と手間をかけて
何も解決しない結果になる。

### 移行中に落ちる時間について

DNS と Pages の切り替え中、**数分〜数時間アクセスできない時間が出る**。
Hiroさんに、いつ実施するかを先に確認すること。

### 移行しても解決しないこと（説明済み・了解済み）

`score.js` は隠せない。ブラウザで動く以上、開発者ツールから必ず読める。
非公開化で防げるのは「GitHub上でソースを読まれること」だけ。
Hiroさんはこれを承知のうえで、その効果を目的として移行を決めている。

---

## 8. 記録済みの失敗（同じ轍を踏まないこと）

外部記憶Vault `claude-memory` にある。

- `mistakes/claimed-deploy-without-live-check` — main へのマージだけでは公開されない。`curl` で実体を確認してから報告する
- `mistakes/mixed-registration-and-verification-sql` — 登録SQLと確認SQLを1ファイルに混ぜて渡した
- `mistakes/zero-bad-rows-check-passes-when-empty` — 「異常0件」で数える検査は、全滅したとき緑になる
- `mistakes/batch-steps-instead-of-one-by-one` — 複雑な手順を長文一括で提示した
