# 星見スポットの承認手順

申請されたスポットを確認して、掲載する／しないを決める手順。
Supabase の SQL エディタ（iPhoneのブラウザで開ける）にSQLを貼って実行する。

- 開く場所: Supabase のプロジェクト → 左メニュー **SQL Editor** → **New query**
- `<TOKEN>` は `admin_config` に入れた管理用トークンに置き換える。
  トークンはこのリポジトリには置かない（→ `knowledge/quick-calc-ops-access`）。

---

## 準備（最初の1回だけ）

`scripts/stars/setup.sql` の中身を SQL エディタに貼って実行する。
これでテーブル・権限・承認用の関数が作られる。

先に `scripts/poll/migrate_ops.sql` を実行してあること（管理用トークンの置き場所
`admin_config` をそちらで作っているため）。まだなら先にそちらを流す。

---

## 手順1: 未承認の申請を見る

```sql
select * from stars_ops_pending('<TOKEN>');
```

出てくる列で確認したいこと:

| 列 | 見るポイント |
|---|---|
| `name` | 実在しそうな名前か。宣伝・いたずらでないか |
| `city` | 市区町村。一覧の絞り込みに使うので、空なら埋めておくとよい |
| `caution` | 気をつけること。冬期閉鎖・トイレ無し・住宅が近いなど。**ここが空でも、危ない要素を知っていれば承認前に書き足す** |
| `pref` / `lat` / `lon` | 都道府県と座標が矛盾していないか |
| `access` / `facilities` / `note` | 私有地・立入禁止を勧めていないか。個人情報が書かれていないか |
| `source_url` | リンク先が妥当か |
| `submitter_hint` | 同じ値が並んでいたら同一端末からの連投 |

`spot_id` は次の手順で使うのでコピーしておく。

---

## 手順2: 掲載する

```sql
select stars_ops_approve('<TOKEN>', '<spot_id>');
```

`true` が返れば掲載された。サイト側は次に開いたときから表示される
（`stars_public_spots()` が承認済みだけを返すため、反映を待つ必要はない）。

---

## 手順2': 掲載しない

```sql
select stars_ops_reject('<TOKEN>', '<spot_id>', '立入禁止の場所のため');
```

却下したものは公開されない。理由は `reject_reason` に残るだけで、
申請者には通知されない（連絡先を集めていないため）。

---

## 手順2'': 完全に消す

誤登録や、権利上の削除依頼を受けたとき。

```sql
select stars_ops_delete('<TOKEN>', '<spot_id>');
```

---

## 手順3: 掲載中の一覧を点検する

```sql
select * from stars_ops_approved('<TOKEN>');
```

新しく承認した順に並ぶ。手順2のあとに1回見て、意図したものが載ったか確かめる。

---

## よくある確認

**申請が届いているか知りたい**

```sql
select count(*) as 未承認 from stars_ops_pending('<TOKEN>');
```

**同じ端末からの連投を調べる**

```sql
select submitter_hint, count(*), min(created_at), max(created_at)
from stars_ops_pending('<TOKEN>')
group by submitter_hint
having count(*) > 1
order by count(*) desc;
```

---

## 覚えておくこと

- 匿名のクライアントは `stars_spots` を**読めない**。未承認の内容が外に出ることはない。
- 匿名のクライアントは `status` を指定できない。申請は必ず `pending` で入る。
- 連投は自動で弾いている（同じ端末は24時間で3件まで、全体で1時間100件まで）。
- 同じ場所（緯度経度を小数3桁＝約100m四方に丸めた単位）に2件目は登録できない。
