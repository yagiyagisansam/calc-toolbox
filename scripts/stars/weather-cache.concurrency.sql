-- 並行して取り込みが走ったときの下ごしらえ。
-- 6分割すべてが揃っていて、まだ公開していない状態を作る。
-- この状態で2つの取り込みを同時に走らせると、公開は1回だけでなければならない。
\set ON_ERROR_STOP on
\o /dev/null
select reset_all();
select set_now('2026-08-20 01:07:00+00');
select request_cycle();
select arrive_ok(i, fake_times(1200000), 7) from generate_series(1, 6) i;
\o
