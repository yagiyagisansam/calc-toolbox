-- =============================================================
-- スポット申請: 住所を足し、座標を管理者が掲載前に確定できるようにする
--
-- これは scripts/stars/setup.sql の変更部分だけを切り出したもの。
-- Supabase の SQL Editor に貼って1回実行する。何度実行しても壊れない。
--
-- なぜ必要か:
--   申請者に地図のピン打ちを求めず、任意の住所を手掛かりとして受け付ける。
--   座標が未確定の申請は、管理者が場所を確認してからでないと承認できない。
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

/*
 * 既に動いている環境向け(申請項目を後から足したため)。
 *
 * add column だけでは制約が付かない。まっさらな環境では列の定義に書いた
 * check がそのまま効くのに、既存の環境では効かないという食い違いが起きる。
 * 同じ HEAD なのに受け付ける値が違う状態になるので、必ず名前を付けて
 * 明示的に足す(名前は、新規に作ったときに PostgreSQL が付ける名前と同じ)。
 *
 * 制約を足す前に既存の値をならす。
 * 前後の空白だけの city は無しにする(絞り込みの見出しが二重に並ぶため)。
 * それでも40文字を超える行が残っていたら、黙って落とさずに止める ──
 * どの行が引っかかったのかを出したうえで、人が決めるべきことなので。
 */
alter table public.stars_spots add column if not exists caution text;
alter table public.stars_spots add column if not exists city text;
alter table public.stars_spots add column if not exists address text;
alter table public.stars_spots alter column lat drop not null;
alter table public.stars_spots alter column lon drop not null;

update public.stars_spots
   set city = nullif(btrim(city), '')
 where city is distinct from nullif(btrim(city), '');
update public.stars_spots
   set address = nullif(btrim(address), '')
 where address is distinct from nullif(btrim(address), '');

do $$
declare
  v_bad text;
begin
  select string_agg(spot_id::text || '(' || char_length(city) || '文字)', ', ')
    into v_bad
    from public.stars_spots
   where city is not null and char_length(city) > 40;
  if v_bad is not null then
    raise exception '市区町村が40文字を超える行があります。手で直してから流し直してください: %', v_bad;
  end if;

  /*
   * 制約があるかは、名前だけでなく対象の表まで見て判断する。
   * conname だけだと、別の表に同じ名前の制約があったときに
   * 「もうある」と誤って判断し、こちらへ足すのを飛ばしてしまう。
   */
  if not exists (
    select 1
      from pg_constraint con
      join pg_class t on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where con.conname = 'stars_spots_caution_check'
       and n.nspname = 'public' and t.relname = 'stars_spots'
  ) then
    alter table public.stars_spots
      add constraint stars_spots_caution_check
      check (caution is null or char_length(caution) <= 500);
  end if;

  if not exists (
    select 1
      from pg_constraint con
      join pg_class t on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where con.conname = 'stars_spots_city_check'
       and n.nspname = 'public' and t.relname = 'stars_spots'
  ) then
    alter table public.stars_spots
      add constraint stars_spots_city_check
      check (city is null or char_length(city) <= 40);
  end if;

  if not exists (
    select 1 from pg_constraint con
      join pg_class t on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where con.conname = 'stars_spots_address_check'
       and n.nspname = 'public' and t.relname = 'stars_spots'
  ) then
    alter table public.stars_spots
      add constraint stars_spots_address_check
      check (address is null or char_length(address) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint con
      join pg_class t on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where con.conname = 'stars_spots_approved_location_check'
       and n.nspname = 'public' and t.relname = 'stars_spots'
  ) then
    alter table public.stars_spots
      add constraint stars_spots_approved_location_check
      check (status <> 'approved' or (lat is not null and lon is not null));
  end if;
end
$$;

grant insert (name, name_kana, pref, city, address, lat, lon, elevation_m, access, facilities, note, caution, source_url, submitter_hint)
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
  -- 座標は申請時には省略できるが、片方だけの値は受け付けない。
  if (new.lat is null) <> (new.lon is null) then
    raise exception 'incomplete location';
  end if;

  -- 対象範囲(日本)の外は受け付けない。海外へ広げるときはここを緩める。
  -- クライアント側の stars/config.js の submitBounds と同じ値にしておくこと。
  if new.lat is not null and
     (new.lat < 20 or new.lat > 46 or new.lon < 122 or new.lon > 154) then
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

  /*
   * 市区町村は一覧の絞り込みの見出しになる。
   * 「阿智村」と「阿智村 」が別の見出しとして2つ並ぶと、
   * 利用者にはどちらを選べばよいのか分からない。
   * 前後の空白を落とし、空になったものは無しとして扱う。
   */
  new.city := nullif(btrim(new.city), '');
  new.address := nullif(btrim(new.address), '');

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
  address        text,
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
    select s.spot_id, s.name, s.pref, s.city, s.address, s.lat, s.lon, s.elevation_m,
           s.access, s.facilities, s.note, s.caution, s.source_url, s.submitter_hint, s.created_at
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
  if exists (select 1 from public.stars_spots where spot_id = p_id and (lat is null or lon is null)) then
    raise exception 'location required before approval';
  end if;
  update public.stars_spots
     set status = 'approved', approved_at = now(), reject_reason = null
   where spot_id = p_id;
  return found;
end;
$$;

-- 申請時に未確定だった座標を、管理者が裏取り後に設定する。
create or replace function public.stars_ops_set_location(
  p_token text, p_id uuid, p_lat double precision, p_lon double precision
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ops_auth(p_token) then
    raise exception 'unauthorized';
  end if;
  if p_lat is null or p_lon is null or p_lat < 20 or p_lat > 46 or p_lon < 122 or p_lon > 154 then
    raise exception 'out of range';
  end if;
  update public.stars_spots set lat = p_lat, lon = p_lon where spot_id = p_id;
  return found;
end;
$$;

revoke all on function public.stars_ops_pending(text, int) from public, anon, authenticated;
revoke all on function public.stars_ops_approve(text, uuid) from public, anon, authenticated;
revoke all on function public.stars_ops_set_location(text, uuid, double precision, double precision) from public, anon, authenticated;

commit;

-- ---- 確認 ----
-- 列が増えたか
select column_name as 列
from information_schema.columns
where table_name = 'stars_spots' and column_name in ('city', 'caution', 'address')
order by column_name;

-- 制約が付いたか(4行出れば成功)
select conname as 制約
from pg_constraint
where conname in ('stars_spots_city_check', 'stars_spots_caution_check',
                  'stars_spots_address_check', 'stars_spots_approved_location_check')
order by conname;

-- 公開用の関数が新しい列を返すか(空でも列名が出れば成功)
select * from public.stars_public_spots() limit 1;
