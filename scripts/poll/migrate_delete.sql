-- =============================================================
-- アンケートの削除(作成者本人・運営のみ)
-- setup.sql → migrate_ops.sql のあとに、SQL Editor で1回だけ実行する
--
-- 方針:
--  - 作成時に端末側で生成した「削除キー」をアンケートに保存する
--  - 削除キーは作成した端末のブラウザにだけ残る(サーバーからは読み出せない)
--  - 削除できるのは「削除キーを持っている作成者本人」と「管理用トークンを持つ運営」だけ
--  - 削除するとそのアンケートの投票・通報も一緒に消える(外部キーのcascade)
-- =============================================================

-- 削除キー(作成時に端末が生成する乱数。あとから読み出す手段は用意しない)
alter table public.polls
  add column if not exists delete_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'polls_delete_key_len'
  ) then
    alter table public.polls
      add constraint polls_delete_key_len
      check (delete_key is null or char_length(delete_key) between 16 and 64);
  end if;
end $$;

-- 作成時にだけ書き込める(更新・読み取りは不可)
grant insert (id, question, options, is_public, multi, max_choices, hide_results, shuffle, closes_at, delete_key)
  on public.polls to anon;

-- 作成者本人による削除。キーが一致したときだけ消す
create or replace function public.delete_poll(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_key is null or char_length(p_key) < 16 then
    return jsonb_build_object('ok', false);
  end if;
  delete from public.polls
   where id = p_id
     and delete_key is not null
     and delete_key = p_key;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

revoke all on function public.delete_poll(text, text) from public, authenticated;
grant execute on function public.delete_poll(text, text) to anon;

-- 運営による削除(管理用トークンが必要)
create or replace function public.ops_delete_poll(p_token text, p_poll_id text)
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
  delete from public.polls where id = p_poll_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'poll_id', p_poll_id, 'deleted', n > 0);
end;
$$;

revoke all on function public.ops_delete_poll(text, text) from public, authenticated;
grant execute on function public.ops_delete_poll(text, text) to anon;

-- =============================================================
-- 運用メモ:
--  - この変更より前に作られたアンケートには削除キーが無く、作成者は自分では削除できない
--    (運営が ops_delete_poll で削除する)
--  - 「公開停止」(ops_block_poll)はデータを残す。完全に消すのは ops_delete_poll
-- =============================================================
