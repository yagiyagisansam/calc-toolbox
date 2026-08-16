-- スキーマの「形」を1つの文字列の並びとして書き出す。
--
-- なぜ要るか:
--   本番へ渡す差分SQLは、正本(setup.sql)をまっさらな環境に流したのと
--   同じ形にならなければ意味がない。これまでは関数の引数名だけを見ていて、
--   city の check 制約が差分側にだけ無いことを見逃した。
--   同じ HEAD なのに、新規に作った DB と、差分を当てた DB とで
--   受け付ける値が違う ── 見た目には何も起きないまま食い違う。
--
-- 見るもの:
--   列(型・NOT NULL・既定値) / 制約 / 索引 / 関数の中身 / 権限
--   ここに出てこない差は検出できない。増やすときはこのファイルに足す。
--
-- 使い方: psql -f schema_signature.sql   (1行1項目で出る。並びは固定)
\pset format unaligned
\pset tuples_only on
\pset footer off

select line from (

  -- 列
  select 1 as g, format('column %s.%s %s null=%s default=%s',
           c.table_name, c.column_name, c.data_type, c.is_nullable,
           coalesce(c.column_default, '-')) as line
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name like 'stars\_%'

  union all
  -- 制約(check / unique / primary key / foreign key)
  select 2, format('constraint %s.%s %s',
           t.relname, con.conname, pg_get_constraintdef(con.oid))
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname like 'stars\_%'

  union all
  -- 索引
  select 3, format('index %s %s', i.tablename, i.indexdef)
    from pg_indexes i
   where i.schemaname = 'public' and i.tablename like 'stars\_%'

  union all
  -- 関数の中身(引数名だけでなく本体まで見る)
  select 4, format('function %s', pg_get_functiondef(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'stars\_%' or p.proname like '%\_stars\_%')

  union all
  -- 表の権限
  select 5, format('table-grant %s %s %s', table_name, grantee, privilege_type)
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'stars\_%'

  union all
  -- 列ごとの権限(anon に insert を許す列がここで決まる)
  select 6, format('column-grant %s.%s %s %s',
           table_name, column_name, grantee, privilege_type)
    from information_schema.column_privileges
   where table_schema = 'public' and table_name like 'stars\_%'

  union all
  -- 関数の実行権限(誰が呼べるか。revoke を書き忘れると全員が呼べる)
  select 7, format('function-grant %s(%s) %s',
           p.proname, pg_get_function_identity_arguments(p.oid),
           coalesce(array_to_string(p.proacl, ' '), 'default'))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'stars\_%' or p.proname like '%\_stars\_%')

  union all
  -- 行レベルセキュリティと方針
  --
  -- relforcerowsecurity(FORCE RLS)も見る。これが落ちていると、
  -- 表の持ち主だけが RLS を素通りする状態の違いに気づけない。
  select 8, format('rls %s enabled=%s forced=%s',
           c.relname, c.relrowsecurity, c.relforcerowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'stars\_%' and c.relkind = 'r'

  union all
  -- 表・関数の持ち主
  select 11, format('owner table %s %s', c.relname, pg_get_userbyid(c.relowner))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'stars\_%' and c.relkind in ('r', 'i', 'S')

  union all
  select 12, format('owner function %s(%s) %s',
           p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'stars\_%' or p.proname like '%\_stars\_%')

  union all
  -- スキーマそのものへの権限(誰が中に物を作れるか)
  select 13, format('schema-grant %s %s', n.nspname,
           coalesce(array_to_string(n.nspacl, ' '), 'default'))
    from pg_namespace n
   where n.nspname = 'public'

  union all
  -- 既定の権限(これから作る物に自動で付く権限)
  select 14, format('default-privilege %s %s %s',
           coalesce(pg_get_userbyid(d.defaclrole), '?'),
           d.defaclobjtype,
           coalesce(array_to_string(d.defaclacl, ' '), 'none'))
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname is null or n.nspname = 'public'

  union all
  select 9, format('policy %s.%s %s %s using=%s check=%s',
           schemaname, tablename, policyname, cmd,
           coalesce(qual, '-'), coalesce(with_check, '-'))
    from pg_policies
   where schemaname = 'public' and tablename like 'stars\_%'

  union all
  -- 引き金(トリガ)
  select 10, format('trigger %s %s', c.relname, pg_get_triggerdef(tg.oid))
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'stars\_%' and not tg.tgisinternal

) s
order by g, line;
