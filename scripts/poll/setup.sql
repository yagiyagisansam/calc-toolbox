-- =============================================================
-- アンケート作成ツール(tools/poll/)用 Supabase セットアップSQL
-- Supabaseダッシュボード → SQL Editor に全文を貼り付けて Run する(1回だけ)
--
-- 設計方針:
--  - 匿名(anon)クライアントができるのは「アンケート作成」「投票」
--    「集計の取得(poll_results関数)」の3つだけ
--  - テーブルの直接読み取り・更新・削除は一切許可しない
--    (アンケートの削除は、このダッシュボードの Table Editor から行う)
--  - 重複投票はブラウザ側の記録に加え、主キー(poll_id, voter)で
--    同じ端末識別子からの2票目をデータベース側でも拒否する
-- =============================================================

-- アンケート本体(id=投票ページURLの10桁、options=選択肢の配列)
create table public.polls (
  id         text primary key check (id ~ '^[a-z0-9]{10}$'),
  question   text not null check (char_length(question) between 1 and 120),
  options    jsonb not null,
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);

-- 選択肢の検証: 2〜10個・すべて文字列・各1〜60文字
create or replace function public.poll_options_valid(opts jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(opts) = 'array'
     and jsonb_array_length(opts) between 2 and 10
     and not exists (
       select 1
       from jsonb_array_elements(opts) as e
       where jsonb_typeof(e) <> 'string'
          or char_length(e #>> '{}') not between 1 and 60
     );
$$;

alter table public.polls
  add constraint polls_options_valid check (public.poll_options_valid(options));

-- 投票(1端末=1 voter につき1票。主キーで2票目を拒否)
create table public.votes (
  poll_id    text not null references public.polls(id) on delete cascade,
  voter      text not null check (char_length(voter) between 8 and 64),
  choice     integer not null check (choice between 0 and 9),
  created_at timestamptz not null default now(),
  primary key (poll_id, voter)
);

-- choiceが実際の選択肢数の範囲内かを検証
-- security definer: 匿名クライアントはpollsを直接読めない(RLS)ため、
-- このチェックだけは所有者権限でpollsを参照する
create or replace function public.check_vote_choice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.polls p
    where p.id = new.poll_id
      and new.choice < jsonb_array_length(p.options)
  ) then
    raise exception 'invalid choice';
  end if;
  return new;
end;
$$;

create trigger votes_check_choice
  before insert on public.votes
  for each row execute function public.check_vote_choice();

-- RLS: 匿名クライアントはINSERTのみ。SELECT/UPDATE/DELETEのポリシーは作らない
alter table public.polls enable row level security;
alter table public.votes enable row level security;

create policy polls_anon_insert on public.polls
  for insert to anon with check (true);

create policy votes_anon_insert on public.votes
  for insert to anon with check (true);

-- 集計の取得(質問・選択肢・選択肢ごとの票数・合計票数をまとめて返す)
-- security definer: テーブルを直接読ませずに、この関数経由でだけ集計を公開する
create or replace function public.poll_results(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',       p.id,
    'question', p.question,
    'options',  p.options,
    'counts', (
      select coalesce(jsonb_agg(t.cnt order by t.idx), '[]'::jsonb)
      from (
        select gs.idx, count(v.poll_id) as cnt
        from generate_series(0, jsonb_array_length(p.options) - 1) as gs(idx)
        left join public.votes v
          on v.poll_id = p.id and v.choice = gs.idx
        group by gs.idx
      ) t
    ),
    'total', (select count(*) from public.votes v where v.poll_id = p.id)
  )
  from public.polls p
  where p.id = p_id;
$$;

grant execute on function public.poll_results(text) to anon;

-- 公開アンケート一覧(人気順/新着順)。security definerで公開行だけを返す
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

-- 通報(1端末につき同じアンケートへ1回まで。内容はダッシュボードで確認して対応)
create table public.reports (
  poll_id    text not null references public.polls(id) on delete cascade,
  reporter   text not null check (char_length(reporter) between 8 and 64),
  created_at timestamptz not null default now(),
  primary key (poll_id, reporter)
);

alter table public.reports enable row level security;

create policy reports_anon_insert on public.reports
  for insert to anon with check (true);

-- =============================================================
-- 運用メモ:
--  - 不適切なアンケートの削除:
--      delete from public.polls where id = '対象のID';
--    (投票データも自動で一緒に消える)
--  - アンケート一覧の確認: Table Editor → polls
-- =============================================================
