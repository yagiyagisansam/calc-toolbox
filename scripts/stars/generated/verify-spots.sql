-- =============================================================
-- 登録できたかの確認(30件)
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
      (select count(*)::text from public.stars_public_spots()), '30'),
  (2, '承認済みの件数',
      (select count(*)::text from public.stars_spots where status = 'approved'), '30'),
  (3, '椿山森林公園(入っていたら誤り)',
      (select count(*)::text from public.stars_public_spots() where name like '%椿山%'), '0'),
  (4, '気をつけることが入っている件数',
      (select count(*)::text from public.stars_public_spots()
        where caution is not null and caution <> ''), '30'),
  (5, '出典が https の件数',
      (select count(*)::text from public.stars_public_spots()
        where source_url like 'https://%'), '30'),
  (6, '座標を取り直した3件が候補どおり',
      (select count(*)::text from public.stars_public_spots()
        where (name = '大山まきばみるくの里' and lat::text = '35.3778565' and lon::text = '133.5107365') or (name = '大川山キャンプ場' and lat::text = '34.1148979' and lon::text = '133.9416574') or (name = '輝北うわば公園キャンプ場' and lat::text = '31.5936' and lon::text = '130.827')), '3')
) as t(n, 項目, 結果, 期待)
order by t.n;
