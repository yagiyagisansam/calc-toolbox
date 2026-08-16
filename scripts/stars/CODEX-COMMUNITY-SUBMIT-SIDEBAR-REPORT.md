# Codex 作業報告: 参加型コンセプト・申請フォーム・共通サイドメニュー

作業日: 2026-08-16
対象: `yagiyagisansam/calc-toolbox` / `main` から作成した Codex ブランチ

## 結論

- 「みんなで星見スポットを登録し、管理者確認後に掲載する」ことをサイト紹介ページと全画面のサイドメニューへ明記した。
- 申請者に地図のピン打ちを求める方式を廃止した。
- ふりがな欄を削除し、住所欄を任意項目として追加した。
- 住所も座標も分からない場合は、スポット名と都道府県だけで申請できる。
- 公開スポットの座標品質を落とさないため、座標未確定の申請は管理者が座標を設定するまで承認できないDB制約を追加した。
- 地図・検索一覧・申請・サイト紹介・データ説明を、同じ暗色テーマと共通サイドメニューに統一した。

## 利用者向け画面

### 新規

- `stars/intro.html`: サイトの目的、参加方法、管理者確認、観測マナーを説明。
- `stars/nav.js`: メニューの開閉、背景クリック、Escapeキー、フォーカス復帰を共通化。

### 変更

- `stars/index.html`
- `stars/list.html`
- `stars/submit.html`
- `stars/about.html`
- `stars/spot.html`
- `stars/stars.css`

上記へ共通サイドメニューを追加した。主要項目は次の5つ。

1. 今夜の星見マップ
2. 流星群・星空の観測スポットを探す
3. スポットを申請
4. このサイトについて
5. データについて

## 申請データの変更

`stars/submit.js` は次の形で申請する。

- 必須: `name`, `pref`
- 任意: `city`, `address`, `elevation_m`, `access`, `facilities`, `caution`, `note`, `source_url`
- 申請時の `lat`, `lon`: どちらも `null`
- `name_kana`: 送らない

住所を任意にしただけでは既存DBの `lat` / `lon not null` に阻まれるため、DB側も次のように変更した。

- `address` 列（最大200文字）を追加。
- pending / rejected は座標なしを許可。
- approved は緯度・経度が必須という検査制約を追加。
- `stars_ops_pending` で住所を確認可能にした。
- `stars_ops_set_location` を追加し、管理者が確認済み座標を設定できるようにした。
- `stars_ops_approve` は座標未確定なら停止する。

## 公開前に必要なSupabase作業

`scripts/stars/generated/migrate-spot-columns.sql` を Supabase SQL Editor で1回実行する。
ファイル末尾の確認結果で次を確認する。

- `address` 列が存在する。
- `stars_spots_address_check` が存在する。
- `stars_spots_approved_location_check` が存在する。
- SQL全体が途中エラーなく `commit` される。

このSQLより先に新しい `submit.html` / `submit.js` を公開すると、住所・座標なし申請がDBに拒否される。そのため公開順は次のとおり。

1. PRを `main` へマージ。
2. 上記SQLをSupabaseへ適用。
3. 確認結果が正常なら `main` を `gh-pages` へ反映。

## 管理者の承認手順

座標が空の申請は、名称・住所・市区町村・参考URLを公式情報等で確認し、次を実行してから承認する。

```sql
select public.stars_ops_set_location('<TOKEN>', '<spot_id>', 確認済み緯度, 確認済み経度);
select public.stars_ops_approve('<TOKEN>', '<spot_id>');
```

詳細は `scripts/stars/ops.md` を参照。座標は推測で埋めない。

## 検証

- `git diff --check`: 通過。
- `node --check stars/nav.js`: 通過。
- `node --check stars/submit.js`: 通過。
- `node --check scripts/stars/verify.mjs`: 通過。
- `node scripts/run_tests.mjs stars`: 62 / 62 通過。
- `node scripts/stars/check_candidates.mjs`: 973 / 973 通過。
- `scripts/stars/build_migration.py`: 差分SQLを再生成できることを確認。
- ローカルブラウザ: 申請ページに地図・ふりがながなく、任意住所、共通サイドメニュー、紹介ページ、Escapeでの閉じ操作を確認。
- PostgreSQL実機テスト: このWindows環境に `psql` / `initdb` がないため未実行。`setup.test.sh` には座標なし申請、未確定座標の承認拒否、座標設定後の承認成功を追加済み。

## Claudeへの注意

- ピン入力を申請必須へ戻さない。
- `address` を必須にしない。
- pending の座標省略を許しても、approved の座標必須制約は外さない。
- サイドメニューの5項目と暗色テーマを画面ごとに独自実装へ戻さない。
- 公開後は住所なし・住所ありの実送信を各1件試す場合でも、テスト申請がDBに残るため管理者の了解を取る。
