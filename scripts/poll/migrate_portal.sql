-- =============================================================
-- ポータル型への移行SQL(2026-07-25・setup.sql実行済みのDBに1回だけ実行)
-- 追加内容: ①公開フラグ ②公開アンケート一覧の取得関数 ③通報テーブル
-- =============================================================

-- ① 公開フラグ(true=ホームの一覧に載る。既存行は非公開のまま)
alter table public.polls
  add column if not exists is_public boolean not null default false;

-- ② 公開アンケート一覧(人気順/新着順)。security definerで公開行だけを返す
create or replace function public.public_polls(p_sort text default 'new', p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select p.id, p.question, p.created_at,
           (select count(*)::int from public.votes v where v.poll_id = p.id) as total
    from public.polls p
    where p.is_public
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

grant execute on function public.public_polls(text, integer) to anon;

-- ③ 通報(1端末につき同じアンケートへ1回まで。内容はダッシュボードで確認して対応)
create table if not exists public.reports (
  poll_id    text not null references public.polls(id) on delete cascade,
  reporter   text not null check (char_length(reporter) between 8 and 64),
  created_at timestamptz not null default now(),
  primary key (poll_id, reporter)
);

alter table public.reports enable row level security;

create policy reports_anon_insert on public.reports
  for insert to anon with check (true);

-- 運用メモ: 通報の確認は Table Editor → reports。
-- 通報されたアンケートを消すには delete from public.polls where id = '対象ID';
