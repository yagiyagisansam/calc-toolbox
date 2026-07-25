-- =============================================================
-- みんなの投票(tools/poll/)用 Supabase セットアップSQL(全機能版)
-- 新しいSupabaseプロジェクトの SQL Editor に全文を貼り付けて Run する(1回だけ)
-- ※既にsetup済みのDBには、migrate_portal.sql / migrate_features.sql を順に使うこと
--
-- 設計方針:
--  - 匿名(anon)クライアントができるのは「作成」「投票」「通報」
--    「集計の取得(poll_results)」「公開一覧の取得(public_polls)」だけ
--  - テーブルの直接読み取り・更新・削除は一切許可しない
--    (アンケートの削除はダッシュボードの Table Editor から行う)
--  - 重複投票はブラウザ側の記録に加え、主キー(poll_id, voter)で
--    同じ端末識別子からの2票目をデータベース側でも拒否する
-- =============================================================

-- アンケート本体
--  multi        = 複数選択を許可
--  hide_results = 投票するまで結果を隠す(締切後は公開)
--  shuffle      = 選択肢をシャッフル表示
--  closes_at    = 投票締切(nullなら無期限)
--  is_public    = ホームの公開一覧に載せる
create table public.polls (
  id           text primary key check (id ~ '^[a-z0-9]{10}$'),
  question     text not null check (char_length(question) between 1 and 120),
  options      jsonb not null,
  is_public    boolean not null default false,
  multi        boolean not null default false,
  hide_results boolean not null default false,
  shuffle      boolean not null default false,
  closes_at    timestamptz,
  created_at   timestamptz not null default now()
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

-- 投票(1端末=1 voter につき1回。choicesは選んだ選択肢の番号の配列)
create table public.votes (
  poll_id    text not null references public.polls(id) on delete cascade,
  voter      text not null check (char_length(voter) between 8 and 64),
  choices    integer[] not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, voter)
);

-- 投票の検証: 締切前・選択数(単一選択は1つ)・範囲内・重複なし
-- security definer: 匿名クライアントはpollsを直接読めない(RLS)ため、
-- このチェックだけは所有者権限でpollsを参照する
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
  select options, multi, closes_at into p from public.polls where id = new.poll_id;
  if p is null then
    raise exception 'poll not found';
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

create trigger votes_check_choices
  before insert on public.votes
  for each row execute function public.check_vote_choices();

-- 通報(1端末につき同じアンケートへ1回まで)
create table public.reports (
  poll_id    text not null references public.polls(id) on delete cascade,
  reporter   text not null check (char_length(reporter) between 8 and 64),
  created_at timestamptz not null default now(),
  primary key (poll_id, reporter)
);

-- RLS: 匿名クライアントはINSERTのみ。SELECT/UPDATE/DELETEのポリシーは作らない
alter table public.polls enable row level security;
alter table public.votes enable row level security;
alter table public.reports enable row level security;

create policy polls_anon_insert on public.polls
  for insert to anon with check (true);

create policy votes_anon_insert on public.votes
  for insert to anon with check (true);

create policy reports_anon_insert on public.reports
  for insert to anon with check (true);

-- 集計の取得(質問・選択肢・票数・回答者数・各種フラグをまとめて返す)
-- p_voter: 端末識別子。「結果非表示」アンケートで投票済みかの判定に使う
create or replace function public.poll_results(p_id text, p_voter text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'question', p.question,
    'options', p.options,
    'multi', p.multi,
    'shuffle', p.shuffle,
    'closes_at', p.closes_at,
    'closed', (p.closes_at is not null and now() >= p.closes_at),
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

grant execute on function public.poll_results(text, text) to anon;

-- 公開アンケート一覧(人気順/新着順)
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

-- =============================================================
-- 運用メモ:
--  - 不適切なアンケートの削除:
--      delete from public.polls where id = '対象のID';
--    (投票・通報データも自動で一緒に消える)
--  - 通報の確認: Table Editor → reports
-- =============================================================
