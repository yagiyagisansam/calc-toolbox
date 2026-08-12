-- =============================================================
-- 星見スポット(quick-calc.site/stars/)のデータベース設定
-- Supabase の SQL Editor に貼って1回だけ実行する
--
-- 前提: 統計ツール(みんなの投票)と同じプロジェクトを使う。
--       管理用トークンの置き場所 admin_config は scripts/poll/migrate_ops.sql で
--       作成済みであること(未実行ならそちらを先に流すこと)。
--
-- 設計方針:
--  - ログイン不要で「申請」だけができる。保存されるのは必ず未承認(pending)の状態
--  - 匿名(anon)クライアントはテーブルを一切読めない。
--    公開する承認済みスポットは stars_public_spots() だけが返す
--    (未承認の投稿内容が外から見えないようにするため)
--  - 承認・却下・削除は管理用トークンを知っている呼び出しだけ(stars_ops_*)
--  - CAPTCHA を置かない代わりに、必須項目・文字数・座標範囲・連投を
--    トリガで機械的に弾く
-- =============================================================

-- ---- ① 都道府県と地方の対応(申請内容の検証に使う) ----
-- ここは scripts/stars/prefectures.mjs から生成している。手で編集しないこと。
create table if not exists public.stars_prefectures (
  pref   text primary key,
  region text not null
);

alter table public.stars_prefectures enable row level security;
revoke all on table public.stars_prefectures from anon, authenticated;

-- @prefs start
insert into public.stars_prefectures (pref, region) values
  ('北海道', '北海道'),
  ('青森県', '東北'),
  ('岩手県', '東北'),
  ('宮城県', '東北'),
  ('秋田県', '東北'),
  ('山形県', '東北'),
  ('福島県', '東北'),
  ('茨城県', '関東'),
  ('栃木県', '関東'),
  ('群馬県', '関東'),
  ('埼玉県', '関東'),
  ('千葉県', '関東'),
  ('東京都', '関東'),
  ('神奈川県', '関東'),
  ('新潟県', '中部'),
  ('富山県', '中部'),
  ('石川県', '中部'),
  ('福井県', '中部'),
  ('山梨県', '中部'),
  ('長野県', '中部'),
  ('岐阜県', '中部'),
  ('静岡県', '中部'),
  ('愛知県', '中部'),
  ('三重県', '近畿'),
  ('滋賀県', '近畿'),
  ('京都府', '近畿'),
  ('大阪府', '近畿'),
  ('兵庫県', '近畿'),
  ('奈良県', '近畿'),
  ('和歌山県', '近畿'),
  ('鳥取県', '中国'),
  ('島根県', '中国'),
  ('岡山県', '中国'),
  ('広島県', '中国'),
  ('山口県', '中国'),
  ('徳島県', '四国'),
  ('香川県', '四国'),
  ('愛媛県', '四国'),
  ('高知県', '四国'),
  ('福岡県', '九州・沖縄'),
  ('佐賀県', '九州・沖縄'),
  ('長崎県', '九州・沖縄'),
  ('熊本県', '九州・沖縄'),
  ('大分県', '九州・沖縄'),
  ('宮崎県', '九州・沖縄'),
  ('鹿児島県', '九州・沖縄'),
  ('沖縄県', '九州・沖縄')
on conflict (pref) do update set region = excluded.region;
-- @prefs end


-- ---- ② スポット本体 ----
create table if not exists public.stars_spots (
  spot_id        uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 2 and 60),
  name_kana      text check (name_kana is null or char_length(name_kana) <= 80),
  pref           text not null references public.stars_prefectures (pref),
  -- region は pref から自動で埋める(申請者に選ばせない。食い違いを防ぐため)
  region         text not null,
  lat            double precision not null,
  lon            double precision not null,
  elevation_m    int check (elevation_m is null or elevation_m between -50 and 4000),
  access         text check (access is null or char_length(access) <= 400),
  facilities     text check (facilities is null or char_length(facilities) <= 400),
  note           text check (note is null or char_length(note) <= 1000),
  source_url     text check (source_url is null or char_length(source_url) <= 300),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason  text,
  -- 端末ごとの識別子(localStorage)。連投を見分けるためだけに使う。個人情報ではない
  submitter_hint text not null check (char_length(submitter_hint) between 8 and 64),
  created_at     timestamptz not null default now(),
  approved_at    timestamptz
);

create index if not exists stars_spots_status_region_idx on public.stars_spots (status, region);
create index if not exists stars_spots_location_idx on public.stars_spots (lat, lon);
create index if not exists stars_spots_submitter_idx on public.stars_spots (submitter_hint, created_at);
create index if not exists stars_spots_created_at_idx on public.stars_spots (created_at);

-- 同じ場所の重複申請を防ぐ(小数3桁 ≒ 100m 四方で1件)
create unique index if not exists stars_spots_unique_place_idx
  on public.stars_spots (round(lat::numeric, 3), round(lon::numeric, 3))
  where status <> 'rejected';

alter table public.stars_spots enable row level security;

-- 匿名クライアントは「未承認としての登録」だけができる
drop policy if exists stars_spots_anon_insert on public.stars_spots;
create policy stars_spots_anon_insert on public.stars_spots
  for insert to anon with check (status = 'pending');

-- 読み取りは一切許可しない(公開分は stars_public_spots() 経由でだけ返す)
revoke all on table public.stars_spots from anon, authenticated;
-- 列単位で絞る。status・region・approved_at・created_at は申請者に触らせない
grant insert (name, name_kana, pref, lat, lon, elevation_m, access, facilities, note, source_url, submitter_hint)
  on public.stars_spots to anon;


-- ---- ③ 申請内容の検証(CAPTCHA の代わり) ----
create or replace function public.check_stars_spot_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_region text;
begin
  -- 対象範囲(日本)の外は受け付けない。海外へ広げるときはここを緩める。
  -- クライアント側の stars/config.js の submitBounds と同じ値にしておくこと。
  if new.lat < 20 or new.lat > 46 or new.lon < 122 or new.lon > 154 then
    raise exception 'out of range';
  end if;

  -- 地方は都道府県から引く(申請者の入力を信用しない)
  select region into v_region from public.stars_prefectures where pref = new.pref;
  if v_region is null then
    raise exception 'unknown prefecture';
  end if;
  new.region := v_region;

  -- 参考URLは https のみ(javascript: や data: を弾く)
  if new.source_url is not null and new.source_url !~ '^https://[^\s]+$' then
    raise exception 'invalid url';
  end if;

  -- 改行だけ・空白だけの名前を弾く
  if btrim(new.name) = '' then
    raise exception 'empty name';
  end if;

  -- レート制限: 同一端末は24時間で3件まで
  if (select count(*) from public.stars_spots
       where submitter_hint = new.submitter_hint
         and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'rate limited';
  end if;

  -- レート制限: 全体で1時間100件まで
  if (select count(*) from public.stars_spots
       where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'rate limited';
  end if;

  new.status := 'pending';
  return new;
end;
$$;

drop trigger if exists stars_spots_check_insert on public.stars_spots;
create trigger stars_spots_check_insert
  before insert on public.stars_spots
  for each row execute function public.check_stars_spot_insert();

revoke all on function public.check_stars_spot_insert() from public, anon, authenticated;


-- ---- ④ 公開用(承認済みだけを返す) ----
create or replace function public.stars_public_spots(p_region text default null)
returns table (
  spot_id     uuid,
  name        text,
  name_kana   text,
  pref        text,
  region      text,
  lat         double precision,
  lon         double precision,
  elevation_m int,
  access      text,
  facilities  text,
  note        text,
  source_url  text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.spot_id, s.name, s.name_kana, s.pref, s.region, s.lat, s.lon,
         s.elevation_m, s.access, s.facilities, s.note, s.source_url
  from public.stars_spots s
  where s.status = 'approved'
    and (p_region is null or s.region = p_region)
  order by s.region, s.pref, s.name;
$$;

grant execute on function public.stars_public_spots(text) to anon, authenticated;


-- ---- ⑤ 承認作業(管理用トークンが要る) ----
-- 使い方は scripts/stars/ops.md を参照。

-- 未承認の一覧
create or replace function public.stars_ops_pending(p_token text, p_limit int default 50)
returns table (
  spot_id        uuid,
  name           text,
  pref           text,
  lat            double precision,
  lon            double precision,
  elevation_m    int,
  access         text,
  facilities     text,
  note           text,
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
    select s.spot_id, s.name, s.pref, s.lat, s.lon, s.elevation_m,
           s.access, s.facilities, s.note, s.source_url, s.submitter_hint, s.created_at
    from public.stars_spots s
    where s.status = 'pending'
    order by s.created_at
    limit greatest(1, least(p_limit, 200));
end;
$$;

-- 承認
create or replace function public.stars_ops_approve(p_token text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ops_auth(p_token) then
    raise exception 'unauthorized';
  end if;
  update public.stars_spots
     set status = 'approved', approved_at = now(), reject_reason = null
   where spot_id = p_id;
  return found;
end;
$$;

-- 却下(理由を残す)
create or replace function public.stars_ops_reject(p_token text, p_id uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ops_auth(p_token) then
    raise exception 'unauthorized';
  end if;
  update public.stars_spots
     set status = 'rejected', reject_reason = p_reason, approved_at = null
   where spot_id = p_id;
  return found;
end;
$$;

-- 完全に消す(誤登録・権利上の削除依頼など)
create or replace function public.stars_ops_delete(p_token text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ops_auth(p_token) then
    raise exception 'unauthorized';
  end if;
  delete from public.stars_spots where spot_id = p_id;
  return found;
end;
$$;

-- 掲載中の一覧(点検用)
create or replace function public.stars_ops_approved(p_token text, p_limit int default 200)
returns table (
  spot_id    uuid,
  name       text,
  pref       text,
  region     text,
  approved_at timestamptz
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
    select s.spot_id, s.name, s.pref, s.region, s.approved_at
    from public.stars_spots s
    where s.status = 'approved'
    order by s.approved_at desc nulls last
    limit greatest(1, least(p_limit, 500));
end;
$$;

-- ops_* は匿名から呼べないようにする(SQL Editor からは postgres 権限で動く)
revoke all on function public.stars_ops_pending(text, int) from public, anon, authenticated;
revoke all on function public.stars_ops_approve(text, uuid) from public, anon, authenticated;
revoke all on function public.stars_ops_reject(text, uuid, text) from public, anon, authenticated;
revoke all on function public.stars_ops_delete(text, uuid) from public, anon, authenticated;
revoke all on function public.stars_ops_approved(text, int) from public, anon, authenticated;
