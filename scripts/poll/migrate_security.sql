-- =============================================================
-- セキュリティ強化SQL(2026-07-25・公開前の最終強化。1回だけ実行)
-- 内容:
--  ① テーブル権限の最小化(列単位のINSERTのみ。created_atの改ざん防止)
--  ② 関数の実行権限の最小化
--  ③ 作成・投票・通報のレート制限(荒らし・容量枯渇対策)
--  ④ 締切の上限(32日以内)などの入力健全性チェック
-- =============================================================

-- ① テーブル権限の最小化
-- RLSに加えて、SQL権限のレベルでも読み書きを絞る(二重ガード)。
-- created_at を列権限から外すことで、作成日時の偽装(新着一覧の上位固定)を防ぐ
revoke all on table public.polls from anon, authenticated;
revoke all on table public.votes from anon, authenticated;
revoke all on table public.reports from anon, authenticated;

grant insert (id, question, options, is_public, multi, max_choices, hide_results, shuffle, closes_at)
  on public.polls to anon;
grant insert (poll_id, voter, choices) on public.votes to anon;
grant insert (poll_id, reporter) on public.reports to anon;

-- ② 関数の実行権限の最小化
revoke all on function public.poll_results(text, text) from public, authenticated;
revoke all on function public.public_polls(text, integer) from public, authenticated;
grant execute on function public.poll_results(text, text) to anon;
grant execute on function public.public_polls(text, integer) to anon;
-- トリガー関数は外部から直接実行できないようにする(トリガー経由の実行には影響しない)
revoke all on function public.check_vote_choices() from public, anon, authenticated;
-- poll_options_valid はCHECK制約の評価でanonが使うため実行権限を残す

-- ③④ レート制限と入力健全性(アンケート作成)
create index if not exists polls_created_at_idx on public.polls (created_at);
create index if not exists votes_created_at_idx on public.votes (created_at);
create index if not exists reports_created_at_idx on public.reports (created_at);

create or replace function public.check_poll_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 全体レート制限: 作成は1時間に300件まで(通常利用では到達しない)
  if (select count(*) from public.polls where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate limited';
  end if;
  -- 締切は32日以内(遠未来の不正な値を防止)
  if new.closes_at is not null and new.closes_at > now() + interval '32 days' then
    raise exception 'invalid deadline';
  end if;
  -- 上限個数は複数選択のときだけ意味を持つ
  if new.max_choices is not null and not new.multi then
    new.max_choices := null;
  end if;
  return new;
end;
$$;

drop trigger if exists polls_check_insert on public.polls;
create trigger polls_check_insert
  before insert on public.polls
  for each row execute function public.check_poll_insert();

revoke all on function public.check_poll_insert() from public, anon, authenticated;

-- ③ レート制限(投票): 1時間に30,000票まで
create or replace function public.check_vote_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.votes where created_at > now() - interval '1 hour') >= 30000 then
    raise exception 'rate limited';
  end if;
  return new;
end;
$$;

drop trigger if exists votes_check_rate on public.votes;
create trigger votes_check_rate
  before insert on public.votes
  for each row execute function public.check_vote_rate();

revoke all on function public.check_vote_rate() from public, anon, authenticated;

-- ③ レート制限(通報): 1時間に300件まで
create or replace function public.check_report_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.reports where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate limited';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_check_insert on public.reports;
create trigger reports_check_insert
  before insert on public.reports
  for each row execute function public.check_report_insert();

revoke all on function public.check_report_insert() from public, anon, authenticated;
