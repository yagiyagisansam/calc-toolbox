-- =============================================================
-- 人気ランキングの期間別集計SQL(2026-07-26・1回だけ実行)
-- public_polls に期間パラメータ p_days を追加:
--   null=全期間 / 7=1週間以内 / 31=1ヶ月以内 / 62=2ヶ月以内
-- 「人気」の票数は期間内に投じられた票だけを数える(新着順は従来どおり)
-- =============================================================

drop function if exists public.public_polls(text, integer);

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

revoke all on function public.public_polls(text, integer, integer) from public, authenticated;
grant execute on function public.public_polls(text, integer, integer) to anon;
