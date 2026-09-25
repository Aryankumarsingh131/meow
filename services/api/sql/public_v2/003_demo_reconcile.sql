-- DEMO FIXTURE RECONCILIATION — one-off, for a database seeded with the
-- original seed_v2 (before 002_hardening). Brings it to the state that seed's
-- own comments describe. Not needed after seeding with seed_v2_demo.sql from
-- this directory, which already produces this state.
--
-- 1. Three reports (f5def4c3, 1c7b1d78, c5e7fe9d) were INSERTED as 'closed', so
--    the later "close" was a no-op and complaints #11, #13, #15 never received
--    their +50 'complaint_resolved'. Move them through action_taken -> closed so
--    the real trigger pays (idempotent: the unique ledger index from 002 stops
--    a second payout).
-- 2. The three reward_redemptions were raw inserts: no ledger debit, no stock
--    decrement. Replace them with guarded redeem_reward() calls.

begin;

do $$
begin
  if exists (select 1 from points_ledger where reason = 'reward_redeemed') then
    raise notice 'already reconciled; nothing to do';
    return;
  end if;

  update reports set status = 'action_taken'
    where id in ('f5def4c3-fe95-5c77-84ae-37bdbff50cfe', '1c7b1d78-954b-5684-a2c2-4c9826295571',
                 'c5e7fe9d-e04f-5fbf-a07a-c1184156c11d') and status = 'closed';
  update reports set status = 'closed', closed_at = now(),
         closure_reason = 'Demo resolution for points-trigger verification.'
    where id in ('f5def4c3-fe95-5c77-84ae-37bdbff50cfe', '1c7b1d78-954b-5684-a2c2-4c9826295571',
                 'c5e7fe9d-e04f-5fbf-a07a-c1184156c11d');

  delete from reward_redemptions where reward_id = '80b675df-276d-5e47-9757-0875c4d3ff13';
  perform redeem_reward(pa.profile_id, '80b675df-276d-5e47-9757-0875c4d3ff13')
    from public_accounts pa
    where pa.phone in ('+91980000011', '+91980000012', '+91980000013');
end $$;

commit;
