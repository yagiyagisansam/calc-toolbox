-- =============================================================
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
-- =============================================================

-- 既に動いている環境向け(caution を後から足したため)
alter table public.stars_spots add column if not exists caution text;
alter table public.stars_spots add column if not exists city text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stars_spots_caution_check'
  ) then
    alter table public.stars_spots
      add constraint stars_spots_caution_check
      check (caution is null or char_length(caution) <= 500);
  end if;
end
$$;

grant insert (name, name_kana, pref, city, lat, lon, elevation_m, access, facilities, note, caution, source_url, submitter_hint)
  on public.stars_spots to anon;


/*
 * 返す列を増やしたときは、create or replace では置き換えられない
 * (PostgreSQL は戻り値の型の変更を許さない)。先に落としてから作り直す。
 * これを書いていなかったため、既に動いている環境へ流すと
 *   Row type defined by OUT parameters is different
 * で途中停止した(scripts/stars/setup.test.sh で検出)。
 */
drop function if exists public.stars_public_spots(text);
create or replace function public.stars_public_spots(p_region text default null)
returns table (
  spot_id     uuid,
  name        text,
  name_kana   text,
  pref        text,
  city        text,
  region      text,
  lat         double precision,
  lon         double precision,
  elevation_m int,
  access      text,
  facilities  text,
  note        text,
  caution     text,
  source_url  text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.spot_id, s.name, s.name_kana, s.pref, s.city, s.region, s.lat, s.lon,
         s.elevation_m, s.access, s.facilities, s.note, s.caution, s.source_url
  from public.stars_spots s
  where s.status = 'approved'
    and (p_region is null or s.region = p_region)
  order by s.region, s.pref, s.name;
$$;

grant execute on function public.stars_public_spots(text) to anon, authenticated;


-- 同上。承認画面に出す列を増やしたので、先に落としてから作り直す。
drop function if exists public.stars_ops_pending(text, int);
create or replace function public.stars_ops_pending(p_token text, p_limit int default 50)
returns table (
  spot_id        uuid,
  name           text,
  pref           text,
  city           text,
  lat            double precision,
  lon            double precision,
  elevation_m    int,
  access         text,
  facilities     text,
  note           text,
  caution        text,
  source_url     text,
  submitter_hint text,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.ops_auth(p_token) then
    raise exception 'unauthorized';
  end if;
  return query
    select s.spot_id, s.name, s.pref, s.city, s.lat, s.lon, s.elevation_m,
           s.access, s.facilities, s.note, s.caution, s.source_url, s.submitter_hint, s.created_at
    from public.stars_spots s
    where s.status = 'pending'
    order by s.created_at
    limit greatest(1, least(p_limit, 200));
end;
$$;

revoke all on function public.stars_ops_pending(text, int) from public, anon, authenticated;


-- ---- 確認 ----
-- 列が増えたか
select column_name as 列
from information_schema.columns
where table_name = 'stars_spots' and column_name in ('city', 'caution')
order by column_name;

-- 公開用の関数が新しい列を返すか(空でも列名が出れば成功)
select * from public.stars_public_spots() limit 1;
