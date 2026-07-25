-- =============================================================
-- 運用(点検・公開停止・不具合報告)用の追加SQL
-- 既にセットアップ済みのDBに、SQL Editor で1回だけ実行する
--
-- 追加するもの:
--  ① 計算ツールの不具合報告テーブル(bug_reports)
--  ② アンケートの公開停止フラグ(polls.blocked)
--  ③ 管理用トークンで守られた点検・対応のRPC(ops_*)
--
-- 設計方針:
--  - 匿名(anon)クライアントができるのは「不具合報告の投稿」だけ(読み取り不可)
--  - 通報・不具合報告の閲覧と、アンケートの公開停止は
--    管理用トークンを知っている呼び出しだけが行える(ops_* 関数)
--  - トークンは公開リポジトリに置かない。実行時に __OPS_TOKEN__ を実際の値へ置き換える
-- =============================================================

-- ---- ① 管理用トークンの保管場所(anonからは一切触れない) ----
create table if not exists public.admin_config (
  key   text primary key,
  value text not null
);

alter table public.admin_config enable row level security;
-- ポリシーを作らないので、anon/authenticated はRLSでも権限でも読めない
revoke all on table public.admin_config from anon, authenticated;

insert into public.admin_config (key, value)
values ('ops_token', '__OPS_TOKEN__')
on conflict (key) do update set value = excluded.value;

-- トークン照合(security definer。失敗しても理由は返さない)
create or replace function public.ops_auth(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_config
    where key = 'ops_token'
      and char_length(coalesce(p_token, '')) >= 32
      and value = p_token
  );
$$;

revoke all on function public.ops_auth(text) from public, anon, authenticated;

-- ---- ② 計算ツールの不具合報告 ----
create table if not exists public.bug_reports (
  id         bigint generated always as identity primary key,
  tool       text not null check (tool ~ '^[a-z0-9-]{1,40}$'),
  message    text not null check (char_length(message) between 5 and 1000),
  reporter   text not null check (char_length(reporter) between 8 and 64),
  status     text not null default 'new' check (status in ('new', 'fixed', 'closed')),
  note       text,
  created_at timestamptz not null default now()
);

alter table public.bug_reports enable row level security;

drop policy if exists bug_reports_anon_insert on public.bug_reports;
create policy bug_reports_anon_insert on public.bug_reports
  for insert to anon with check (true);

-- 権限も列単位で最小化(created_at・status・note の偽装を防ぐ)
revoke all on table public.bug_reports from anon, authenticated;
grant insert (tool, message, reporter) on public.bug_reports to anon;

create index if not exists bug_reports_created_at_idx on public.bug_reports (created_at);
create index if not exists bug_reports_status_idx on public.bug_reports (status);

-- レート制限: 全体1時間200件・同一端末1時間10件
create or replace function public.check_bug_report_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.bug_reports where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate limited';
  end if;
  if (select count(*) from public.bug_reports
       where reporter = new.reporter and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate limited';
  end if;
  return new;
end;
$$;

drop trigger if exists bug_reports_check_insert on public.bug_reports;
create trigger bug_reports_check_insert
  before insert on public.bug_reports
  for each row execute function public.check_bug_report_insert();

revoke all on function public.check_bug_report_insert() from public, anon, authenticated;

-- ---- ③ アンケートの公開停止フラグと、通報の対応状況 ----
alter table public.polls   add column if not exists blocked     boolean not null default false;
alter table public.reports add column if not exists reviewed_at timestamptz;

create index if not exists reports_reviewed_at_idx on public.reports (reviewed_at);

-- 公開停止したアンケートには投票できない
create or replace function public.check_vote_choices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  n int;
  i int;
begin
  select options, multi, max_choices, closes_at, blocked into p from public.polls where id = new.poll_id;
  if p is null then
    raise exception 'poll not found';
  end if;
  if p.blocked then
    raise exception 'poll blocked';
  end if;
  if p.closes_at is not null and now() >= p.closes_at then
    raise exception 'poll closed';
  end if;
  n := jsonb_array_length(p.options);
  if new.choices is null or array_length(new.choices, 1) is null then
    raise exception 'invalid choice';
  end if;
  if not p.multi and array_length(new.choices, 1) <> 1 then
    raise exception 'invalid choice';
  end if;
  if p.multi and p.max_choices is not null and array_length(new.choices, 1) > p.max_choices then
    raise exception 'invalid choice';
  end if;
  if array_length(new.choices, 1) > n then
    raise exception 'invalid choice';
  end if;
  if (select count(distinct c) from unnest(new.choices) c) <> array_length(new.choices, 1) then
    raise exception 'invalid choice';
  end if;
  foreach i in array new.choices loop
    if i < 0 or i >= n then
      raise exception 'invalid choice';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.check_vote_choices() from public, anon, authenticated;

-- 公開停止したアンケートは一覧に出さない
create or replace function public.public_polls(p_sort text default 'new', p_limit integer default 20, p_days integer default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select p.id, p.question, p.created_at,
           (select count(*)::int from public.votes v
             where v.poll_id = p.id
               and (p_days is null
                    or v.created_at > now() - make_interval(days => least(greatest(p_days, 1), 366)))
           ) as total
    from public.polls p
    where p.is_public and not p.blocked
  ), ordered as (
    select b.*,
           row_number() over (
             order by
               case when p_sort = 'popular' then b.total end desc nulls last,
               b.created_at desc
           ) as rn
    from base b
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('id', o.id, 'question', o.question, 'total', o.total) order by o.rn),
    '[]'::jsonb)
  from ordered o
  where o.rn <= least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.public_polls(text, integer, integer) from public, authenticated;
grant execute on function public.public_polls(text, integer, integer) to anon;

-- 公開停止したアンケートは中身を返さず、停止した事実だけを返す
create or replace function public.poll_results(p_id text, p_voter text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p.blocked then
    jsonb_build_object('id', p.id, 'blocked', true)
  else
    jsonb_build_object(
      'id', p.id,
      'question', p.question,
      'options', p.options,
      'multi', p.multi,
      'max_choices', p.max_choices,
      'shuffle', p.shuffle,
      'closes_at', p.closes_at,
      'closed', (p.closes_at is not null and now() >= p.closes_at),
      'blocked', false,
      'hidden', hid.hidden,
      'total', (select count(*) from public.votes v where v.poll_id = p.id),
      'counts', case when hid.hidden then null else (
        select coalesce(jsonb_agg(t.cnt order by t.idx), '[]'::jsonb)
        from (
          select gs.idx, count(v.poll_id) as cnt
          from generate_series(0, jsonb_array_length(p.options) - 1) as gs(idx)
          left join public.votes v
            on v.poll_id = p.id and gs.idx = any(v.choices)
          group by gs.idx
        ) t
      ) end
    )
  end
  from public.polls p,
  lateral (
    select (p.hide_results
            and (p.closes_at is null or now() < p.closes_at)
            and (p_voter is null or not exists (
              select 1 from public.votes v where v.poll_id = p.id and v.voter = p_voter))
           ) as hidden
  ) hid
  where p.id = p_id;
$$;

revoke all on function public.poll_results(text, text) from public, authenticated;
grant execute on function public.poll_results(text, text) to anon;

-- ---- ④ 点検・対応のRPC(管理用トークンが必要) ----

-- 未対応の通報と不具合報告をまとめて返す
create or replace function public.ops_pending(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.ops_auth(p_token) then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(x order by x->>'first_reported')
      from (
        select jsonb_build_object(
                 'poll_id', p.id,
                 'question', p.question,
                 'options', p.options,
                 'is_public', p.is_public,
                 'blocked', p.blocked,
                 'created_at', p.created_at,
                 'votes', (select count(*) from public.votes v where v.poll_id = p.id),
                 'report_count', count(*),
                 'first_reported', min(r.created_at)
               ) as x
        from public.reports r
        join public.polls p on p.id = r.poll_id
        where r.reviewed_at is null
        group by p.id, p.question, p.options, p.is_public, p.blocked, p.created_at
      ) s
    ), '[]'::jsonb),
    'bugs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'tool', b.tool, 'message', b.message, 'created_at', b.created_at
             ) order by b.created_at)
      from public.bug_reports b
      where b.status = 'new'
    ), '[]'::jsonb)
  );
end;
$$;

-- アンケートを公開停止にする(通報も対応済みにする)
create or replace function public.ops_block_poll(p_token text, p_poll_id text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.ops_auth(p_token) then
    raise exception 'forbidden';
  end if;
  update public.polls set blocked = true where id = p_poll_id;
  get diagnostics n = row_count;
  update public.reports set reviewed_at = now() where poll_id = p_poll_id and reviewed_at is null;
  return jsonb_build_object('ok', n > 0, 'poll_id', p_poll_id, 'blocked', true, 'note', p_note);
end;
$$;

-- 通報を「問題なし」として対応済みにする(公開は続ける)
create or replace function public.ops_keep_poll(p_token text, p_poll_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.ops_auth(p_token) then
    raise exception 'forbidden';
  end if;
  update public.reports set reviewed_at = now() where poll_id = p_poll_id and reviewed_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'poll_id', p_poll_id, 'reviewed', n);
end;
$$;

-- 不具合報告の対応状況を更新する(fixed=修正済み / closed=対応不要)
create or replace function public.ops_close_bug(p_token text, p_id bigint, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.ops_auth(p_token) then
    raise exception 'forbidden';
  end if;
  if p_status not in ('fixed', 'closed') then
    raise exception 'invalid status';
  end if;
  update public.bug_reports set status = p_status, note = p_note where id = p_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'id', p_id, 'status', p_status);
end;
$$;

revoke all on function public.ops_pending(text) from public, authenticated;
revoke all on function public.ops_block_poll(text, text, text) from public, authenticated;
revoke all on function public.ops_keep_poll(text, text) from public, authenticated;
revoke all on function public.ops_close_bug(text, bigint, text, text) from public, authenticated;

grant execute on function public.ops_pending(text) to anon;
grant execute on function public.ops_block_poll(text, text, text) to anon;
grant execute on function public.ops_keep_poll(text, text) to anon;
grant execute on function public.ops_close_bug(text, bigint, text, text) to anon;

-- =============================================================
-- 運用メモ:
--  - 毎日の点検は ops_pending で未対応分を取得する
--  - 問題のあるアンケートは ops_block_poll で公開停止(データは残す)
--  - 完全に消す場合は従来どおり delete from public.polls where id = '対象のID';
-- =============================================================
