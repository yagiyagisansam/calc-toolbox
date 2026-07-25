-- =============================================================
-- 機能追加SQL(2026-07-25・migrate_portal.sql実行済みのDBに1回だけ実行)
-- 追加内容: ①複数選択 ②投票締切 ③投票するまで結果非表示 ④選択肢シャッフル
-- 注意: votesテーブルを複数選択対応(choices配列)に作り直すため既存の票は消える
--       (公開前のため影響なし)
-- =============================================================

alter table public.polls add column if not exists multi boolean not null default false;
alter table public.polls add column if not exists hide_results boolean not null default false;
alter table public.polls add column if not exists shuffle boolean not null default false;
alter table public.polls add column if not exists closes_at timestamptz;
alter table public.polls add column if not exists max_choices integer check (max_choices between 2 and 10);

-- votesを複数選択対応に作り直す
drop table if exists public.votes;
create table public.votes (
  poll_id    text not null references public.polls(id) on delete cascade,
  voter      text not null check (char_length(voter) between 8 and 64),
  choices    integer[] not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, voter)
);

alter table public.votes enable row level security;

create policy votes_anon_insert on public.votes
  for insert to anon with check (true);

-- 投票の検証: 締切前・選択数(単一選択は1つ)・範囲内・重複なし
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
  select options, multi, max_choices, closes_at into p from public.polls where id = new.poll_id;
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

create trigger votes_check_choices
  before insert on public.votes
  for each row execute function public.check_vote_choices();

-- 集計RPCを作り直す(回答者数ベース・複数選択・結果非表示・締切に対応)
-- p_voter: 投票済み判定に使う端末識別子(結果非表示アンケートで、投票済みなら結果を返す)
drop function if exists public.poll_results(text);

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
    'max_choices', p.max_choices,
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
