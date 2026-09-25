-- JalSakshi public v2 — DEMO FIXTURES (fictional, synthetic, not domain-validated).
-- Order: 001_schema.sql -> 002_hardening.sql -> this file -> 004_erd_workflows.sql.
-- All demo passwords are '1234' (hashed). Public accounts must change it on first login.
--
-- Differences from the originally supplied seed_v2.sql (each fixed a real failure):
--  * Public phones are E.164 ('+91980000001'): 002 enforces one account per number.
--  * Central Hills Hand Pump #1 is inserted gps_auto and switched to manual_override
--    together with its reason; inserting manual_override first violates
--    chk_manual_override_requires_reason and aborts the seed.
--  * Reports f5def4c3, 1c7b1d78, c5e7fe9d start at 'action_taken' (were 'closed'),
--    so closing them fires the +50 'complaint_resolved' the seed says it verifies.
--  * Redemptions go through redeem_reward() (ledger debit + stock decrement), not raw inserts.

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at)
select id::uuid, email, extensions.crypt('1234', extensions.gen_salt('bf')), now(), now() from (values
  ('da8334ff-a77a-5e9a-9083-4354340dbe97', 'supervisor.north.valley.demo@example.org'),
  ('ef7a35d0-710e-5f7e-8557-8346fbdf33bf', 'supervisor.south.ridge.demo@example.org'),
  ('b1dd56bc-fe96-5352-99e6-0f1b5ff5d2ca', 'supervisor.east.plains.demo@example.org'),
  ('14f2e340-6480-5308-9a7d-63c5318d178c', 'supervisor.west.coast.demo@example.org'),
  ('0c2bd303-4fae-5faf-807d-b8a2c79ee6bf', 'supervisor.central.hills.demo@example.org'),
  ('538dad1c-daeb-5cd3-a717-8e885bcfd088', 'supervisor.coastal.delta.demo@example.org'),
  ('fffb0d67-fc42-55e2-8d9f-a014364f4548', 'field.worker.north.valley-1.demo@example.org'),
  ('35c8152d-2ec1-56b0-a43e-29784b84be72', 'field.worker.north.valley-2.demo@example.org'),
  ('5faaa5c6-3b04-5580-9646-550dccc74ef2', 'field.worker.south.ridge-1.demo@example.org'),
  ('06f37c66-f0a1-57bc-a176-e07d99e50a85', 'field.worker.south.ridge-2.demo@example.org'),
  ('2d9cf24d-1775-5653-93bb-6bda813c9741', 'field.worker.east.plains-1.demo@example.org'),
  ('0524652c-e8ed-5b8a-a399-0201a3da7148', 'field.worker.east.plains-2.demo@example.org'),
  ('356e6ff6-742a-5ddb-ad79-3ddf0bf9ee2b', 'field.worker.west.coast-1.demo@example.org'),
  ('3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7', 'field.worker.west.coast-2.demo@example.org'),
  ('53c12380-1f99-5237-b7b6-9bf96d512248', 'field.worker.central.hills-1.demo@example.org'),
  ('a5930112-de58-5f5e-8958-814366a9d79e', 'field.worker.central.hills-2.demo@example.org'),
  ('3bf0db99-559d-56b7-8385-7263aee32c64', 'field.worker.coastal.delta-1.demo@example.org'),
  ('414a9c3b-255b-5e35-a1d3-df540857c944', 'field.worker.coastal.delta-2.demo@example.org')
) as u(id, email)
on conflict (id) do nothing;

insert into organizations (id, name, org_type, contact_info) values
  ('6aa61d09-664a-5117-88dc-e601aefe6449', 'Clearwater Trust (NGO)', 'ngo', 'contact@clearwater-demo.org'),
  ('3d9a971a-0e60-5271-bc67-afc040944bf4', 'JalRaksha Foundation (NGO)', 'ngo', 'info@jalraksha-demo.org'),
  ('c45b261f-2a0d-55aa-9b62-21bb81bc6c76', 'Ward 7 Gram Panchayat', 'panchayat', 'panchayat.ward7@example.org'),
  ('17fb97e0-a48c-5ab3-ae05-c4c8945340ae', 'Ward 3 Gram Panchayat', 'panchayat', 'panchayat.ward3@example.org'),
  ('0ff2a19a-3893-59db-85b1-77a0fb08e13d', 'Rangoli Textiles Pvt Ltd', 'industrial', 'compliance@rangoli-demo.com')
on conflict (id) do nothing;

insert into teams (id, name, region) values
  ('fc778e68-d6ae-52ff-ab8c-9a0333f915bd', 'North Valley Field Team', 'North Valley'),
  ('c5eb31d3-79f1-588b-a4f4-a55e6209b263', 'South Ridge Field Team', 'South Ridge'),
  ('6fa4a23b-18d6-52ec-a072-13cb9fce5d50', 'East Plains Field Team', 'East Plains'),
  ('f14fd926-8574-55e2-b9d7-b6d5fe1c4e79', 'West Coast Field Team', 'West Coast'),
  ('f1c258aa-d9cd-5c96-bc5e-259cb38520f1', 'Central Hills Field Team', 'Central Hills'),
  ('96af0256-1317-53f4-9fd1-98b24de53987', 'Coastal Delta Field Team', 'Coastal Delta')
on conflict (id) do nothing;

insert into profiles (id, auth_user_id, role, full_name, phone, language_pref, team_id)
select id::uuid, id::uuid, role, full_name, phone, lang, team::uuid from (values
  ('da8334ff-a77a-5e9a-9083-4354340dbe97', 'supervisor', 'Supervisor North Valley', '+91-90000-1001', 'en', 'fc778e68-d6ae-52ff-ab8c-9a0333f915bd'),
  ('ef7a35d0-710e-5f7e-8557-8346fbdf33bf', 'supervisor', 'Supervisor South Ridge', '+91-90000-1002', 'en', 'c5eb31d3-79f1-588b-a4f4-a55e6209b263'),
  ('b1dd56bc-fe96-5352-99e6-0f1b5ff5d2ca', 'supervisor', 'Supervisor East Plains', '+91-90000-1003', 'en', '6fa4a23b-18d6-52ec-a072-13cb9fce5d50'),
  ('14f2e340-6480-5308-9a7d-63c5318d178c', 'supervisor', 'Supervisor West Coast', '+91-90000-1004', 'en', 'f14fd926-8574-55e2-b9d7-b6d5fe1c4e79'),
  ('0c2bd303-4fae-5faf-807d-b8a2c79ee6bf', 'supervisor', 'Supervisor Central Hills', '+91-90000-1005', 'en', 'f1c258aa-d9cd-5c96-bc5e-259cb38520f1'),
  ('538dad1c-daeb-5cd3-a717-8e885bcfd088', 'supervisor', 'Supervisor Coastal Delta', '+91-90000-1006', 'en', '96af0256-1317-53f4-9fd1-98b24de53987'),
  ('fffb0d67-fc42-55e2-8d9f-a014364f4548', 'field_worker', 'Field Worker North Valley-1', '+91-90000-2011', 'hi', 'fc778e68-d6ae-52ff-ab8c-9a0333f915bd'),
  ('35c8152d-2ec1-56b0-a43e-29784b84be72', 'field_worker', 'Field Worker North Valley-2', '+91-90000-2012', 'hi', 'fc778e68-d6ae-52ff-ab8c-9a0333f915bd'),
  ('5faaa5c6-3b04-5580-9646-550dccc74ef2', 'field_worker', 'Field Worker South Ridge-1', '+91-90000-2021', 'hi', 'c5eb31d3-79f1-588b-a4f4-a55e6209b263'),
  ('06f37c66-f0a1-57bc-a176-e07d99e50a85', 'field_worker', 'Field Worker South Ridge-2', '+91-90000-2022', 'hi', 'c5eb31d3-79f1-588b-a4f4-a55e6209b263'),
  ('2d9cf24d-1775-5653-93bb-6bda813c9741', 'field_worker', 'Field Worker East Plains-1', '+91-90000-2031', 'hi', '6fa4a23b-18d6-52ec-a072-13cb9fce5d50'),
  ('0524652c-e8ed-5b8a-a399-0201a3da7148', 'field_worker', 'Field Worker East Plains-2', '+91-90000-2032', 'hi', '6fa4a23b-18d6-52ec-a072-13cb9fce5d50'),
  ('356e6ff6-742a-5ddb-ad79-3ddf0bf9ee2b', 'field_worker', 'Field Worker West Coast-1', '+91-90000-2041', 'hi', 'f14fd926-8574-55e2-b9d7-b6d5fe1c4e79'),
  ('3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7', 'field_worker', 'Field Worker West Coast-2', '+91-90000-2042', 'hi', 'f14fd926-8574-55e2-b9d7-b6d5fe1c4e79'),
  ('53c12380-1f99-5237-b7b6-9bf96d512248', 'field_worker', 'Field Worker Central Hills-1', '+91-90000-2051', 'hi', 'f1c258aa-d9cd-5c96-bc5e-259cb38520f1'),
  ('a5930112-de58-5f5e-8958-814366a9d79e', 'field_worker', 'Field Worker Central Hills-2', '+91-90000-2052', 'hi', 'f1c258aa-d9cd-5c96-bc5e-259cb38520f1'),
  ('3bf0db99-559d-56b7-8385-7263aee32c64', 'field_worker', 'Field Worker Coastal Delta-1', '+91-90000-2061', 'hi', '96af0256-1317-53f4-9fd1-98b24de53987'),
  ('414a9c3b-255b-5e35-a1d3-df540857c944', 'field_worker', 'Field Worker Coastal Delta-2', '+91-90000-2062', 'hi', '96af0256-1317-53f4-9fd1-98b24de53987')
) as p(id, role, full_name, phone, lang, team)
on conflict (id) do nothing;

select create_public_login(phone, name) from (values
  ('+91980000001', 'Vikram Rao'), ('+91980000002', 'Sunita Patil'), ('+91980000003', 'Farah Sheikh'),
  ('+91980000004', 'Arjun Mehta'), ('+91980000005', 'Priya Nair'), ('+91980000006', 'Manoj Kumar'),
  ('+91980000007', 'Lakshmi Iyer'), ('+91980000008', 'Rahul Verma'), ('+91980000009', 'Anjali Singh'),
  ('+91980000010', 'Deepak Joshi'), ('+91980000011', 'Kavita Reddy'), ('+91980000012', 'Sanjay Gupta'),
  ('+91980000013', 'Neha Kapoor'), ('+91980000014', 'Imran Khan'), ('+91980000015', 'Pooja Desai')
) as a(phone, name)
where not exists (select 1 from public_accounts pa where pa.phone = a.phone);

insert into water_sources (id, name, source_type, location, location_source, location_accuracy_m,
                           approx_size, village, ward, team_id, org_id, created_by)
select id::uuid, name, stype, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, 'gps_auto', acc,
       size, village, ward, team::uuid, org::uuid, creator::uuid
from (values
  ('0970b397-9a14-5a52-b5b9-bdd37a956cfd', 'North Valley Tank #1', 'tank', 75.6715, 22.90837, 8.0, 'approx large capacity', 'North Valley', 'Ward 6', 'fc778e68-d6ae-52ff-ab8c-9a0333f915bd', null, 'fffb0d67-fc42-55e2-8d9f-a014364f4548'),
  ('c4487b44-ad31-543f-9953-2a00917c9a90', 'North Valley Tap #2', 'tap', 75.68339, 22.8865, 6.5, 'approx large capacity', 'North Valley', 'Ward 2', 'fc778e68-d6ae-52ff-ab8c-9a0333f915bd', '0ff2a19a-3893-59db-85b1-77a0fb08e13d', 'fffb0d67-fc42-55e2-8d9f-a014364f4548'),
  ('9b5ac715-4370-545f-a4af-047887a027d8', 'North Valley Pond #3', 'pond', 75.7106, 22.91419, 3.3, 'approx small capacity', 'North Valley', 'Ward 5', 'fc778e68-d6ae-52ff-ab8c-9a0333f915bd', null, 'fffb0d67-fc42-55e2-8d9f-a014364f4548'),
  ('5db5487a-5318-598e-8d71-3d28e032c9d5', 'South Ridge Tap #1', 'tap', 75.87522, 22.62353, 8.9, 'approx small capacity', 'South Ridge', 'Ward 2', 'c5eb31d3-79f1-588b-a4f4-a55e6209b263', null, '5faaa5c6-3b04-5580-9646-550dccc74ef2'),
  ('fe9dc7af-dd8b-5be1-91f4-18f664931a27', 'South Ridge Pond #2', 'pond', 75.87179, 22.59532, 5.3, 'approx medium capacity', 'South Ridge', 'Ward 6', 'c5eb31d3-79f1-588b-a4f4-a55e6209b263', null, '5faaa5c6-3b04-5580-9646-550dccc74ef2'),
  ('15b088a2-0acf-5019-a21c-9cd33baf4f7d', 'South Ridge River #3', 'river', 75.90032, 22.58312, 4.0, 'approx medium capacity', 'South Ridge', 'Ward 4', 'c5eb31d3-79f1-588b-a4f4-a55e6209b263', null, '5faaa5c6-3b04-5580-9646-550dccc74ef2'),
  ('402eeb06-7c4c-5b0a-9b2a-fd24ef291dbb', 'East Plains Pond #1', 'pond', 76.03193, 22.72159, 7.0, 'approx large capacity', 'East Plains', 'Ward 2', '6fa4a23b-18d6-52ec-a072-13cb9fce5d50', null, '2d9cf24d-1775-5653-93bb-6bda813c9741'),
  ('fa04e6f8-7364-56f9-9ce3-6031bed2b891', 'East Plains River #2', 'river', 76.0527, 22.75899, 6.7, 'approx small capacity', 'East Plains', 'Ward 9', '6fa4a23b-18d6-52ec-a072-13cb9fce5d50', null, '2d9cf24d-1775-5653-93bb-6bda813c9741'),
  ('b6e646c2-45e0-504e-9f12-44c1ac18bb15', 'East Plains Hand Pump #3', 'hand_pump', 76.05536, 22.73323, 7.4, 'approx small capacity', 'East Plains', 'Ward 8', '6fa4a23b-18d6-52ec-a072-13cb9fce5d50', null, '2d9cf24d-1775-5653-93bb-6bda813c9741'),
  ('0cc2cb25-677c-5eda-a827-0c5e9b19ee98', 'West Coast River #1', 'river', 75.52039, 22.66857, 5.3, 'approx large capacity', 'West Coast', 'Ward 9', 'f14fd926-8574-55e2-b9d7-b6d5fe1c4e79', null, '356e6ff6-742a-5ddb-ad79-3ddf0bf9ee2b'),
  ('f7fc6ba6-5c95-54ce-8232-577155d767cb', 'West Coast Hand Pump #2', 'hand_pump', 75.56189, 22.66835, 4.3, 'approx medium capacity', 'West Coast', 'Ward 1', 'f14fd926-8574-55e2-b9d7-b6d5fe1c4e79', null, '356e6ff6-742a-5ddb-ad79-3ddf0bf9ee2b'),
  ('4bea76e4-4471-5fac-9ec5-96dc38642691', 'West Coast Well #3', 'well', 75.52933, 22.64042, 4.4, 'approx small capacity', 'West Coast', 'Ward 6', 'f14fd926-8574-55e2-b9d7-b6d5fe1c4e79', null, '356e6ff6-742a-5ddb-ad79-3ddf0bf9ee2b'),
  ('fd02d6e6-8b1b-56f1-8ffc-4ea01d3e2f60', 'Central Hills Hand Pump #1', 'hand_pump', 75.7902, 22.74743, null, 'approx medium capacity', 'Central Hills', 'Ward 5', 'f1c258aa-d9cd-5c96-bc5e-259cb38520f1', null, '53c12380-1f99-5237-b7b6-9bf96d512248'),
  ('a11ba9d1-9b94-5bb4-854f-c0a71cfea0f0', 'Central Hills Well #2', 'well', 75.7758, 22.69556, 3.4, 'approx large capacity', 'Central Hills', 'Ward 6', 'f1c258aa-d9cd-5c96-bc5e-259cb38520f1', null, '53c12380-1f99-5237-b7b6-9bf96d512248'),
  ('0af2680d-3265-5b1e-9389-47a4d332de62', 'Central Hills Tank #3', 'tank', 75.80622, 22.74085, 4.3, 'approx medium capacity', 'Central Hills', 'Ward 7', 'f1c258aa-d9cd-5c96-bc5e-259cb38520f1', null, '53c12380-1f99-5237-b7b6-9bf96d512248'),
  ('3b13b5e9-8d60-59cd-89fe-86bc5c62b1fa', 'Coastal Delta Well #1', 'well', 75.96378, 22.51843, 8.3, 'approx large capacity', 'Coastal Delta', 'Ward 8', '96af0256-1317-53f4-9fd1-98b24de53987', null, '3bf0db99-559d-56b7-8385-7263aee32c64'),
  ('e5170f82-dbc7-599d-bbc9-5ab7156ac682', 'Coastal Delta Tank #2', 'tank', 75.97839, 22.50217, 3.9, 'approx small capacity', 'Coastal Delta', 'Ward 4', '96af0256-1317-53f4-9fd1-98b24de53987', null, '3bf0db99-559d-56b7-8385-7263aee32c64'),
  ('9e2077a9-228d-5853-a524-463249016d2f', 'Coastal Delta Tap #3', 'tap', 75.95312, 22.49271, 7.5, 'approx large capacity', 'Coastal Delta', 'Ward 5', '96af0256-1317-53f4-9fd1-98b24de53987', null, '3bf0db99-559d-56b7-8385-7263aee32c64')
) as s(id, name, stype, lon, lat, acc, size, village, ward, team, org, creator)
on conflict (id) do nothing;

update water_sources set location_source = 'manual_override', location_auto_pinned = false,
  location_overridden_by = '0c2bd303-4fae-5faf-807d-b8a2c79ee6bf',
  location_override_reason = 'Indoor rooftop tank, GPS signal blocked; pinned manually from site survey plan.'
  where id = 'fd02d6e6-8b1b-56f1-8ffc-4ea01d3e2f60' and location_source = 'gps_auto';

insert into test_kits (id, name, strip_type, icon_ref, timing_window_sec) values
  ('6ecff65c-ff32-5141-83dd-9b51f9953ba2', 'AquaCheck Chlorine Strip', 'chlorine', 'icon_chlorine_strip', 30),
  ('a6083e59-ca4e-5206-9c82-e860c014eab0', 'AquaCheck Iron Strip', 'iron', 'icon_iron_strip', 60),
  ('c3800013-6073-502d-b1f0-3dc9e3d5fc03', 'AquaCheck Coliform Kit', 'coliform', 'icon_coliform_kit', 86400),
  ('719692d9-87c7-5bc1-807c-52cc7080bfe2', 'AquaCheck pH Strip', 'pH', 'icon_ph_strip', 20),
  ('ab53bad2-ac6e-5c1e-abd4-13897b56ea6d', 'AquaCheck TDS Meter Strip', 'TDS', 'icon_tds_strip', 15)
on conflict (id) do nothing;

-- method 'manual' rows carry raw_input; 'camera' rows carry autofill_calculation.
insert into test_records (id, source_id, performed_by, kit_id, method, dropdown_selection,
                          raw_input, autofill_calculation, computed_risk_level,
                          local_record_id, cached_locally, synced_at)
select id::uuid, src::uuid, who::uuid, kit::uuid, method, 'strip_selected',
       case when method = 'manual' then jsonb_build_object('observed_color', 'band-' || risk, 'worker_note', 'read by eye against reference card') end,
       case when method = 'camera' then jsonb_build_object('model_version', 'onnx-v0.3-demo', 'confidence', conf, 'risk_band', risk) end,
       risk, local_id::uuid, true, now() - make_interval(days => age)
from (values
  ('379daec6-409c-5b30-a834-5f6d480155f7', 'a11ba9d1-9b94-5bb4-854f-c0a71cfea0f0', 'a5930112-de58-5f5e-8958-814366a9d79e', 'c3800013-6073-502d-b1f0-3dc9e3d5fc03', 'manual', null::numeric, 'low', 'febbf619-65be-523e-ac78-245cbbcba0d6', 8),
  ('2e4df8e0-b3af-5d1f-822d-84dbd725e391', 'fe9dc7af-dd8b-5be1-91f4-18f664931a27', '06f37c66-f0a1-57bc-a176-e07d99e50a85', '6ecff65c-ff32-5141-83dd-9b51f9953ba2', 'camera', 0.62, 'low', '2f0ad115-047d-5ab5-9480-e74a85871825', 2),
  ('2cd5b68d-e4dc-5945-98bc-b80ee4cb15c5', '5db5487a-5318-598e-8d71-3d28e032c9d5', '5faaa5c6-3b04-5580-9646-550dccc74ef2', 'a6083e59-ca4e-5206-9c82-e860c014eab0', 'manual', null, 'high', 'b7995c51-5542-568f-9f76-73ef4c043bd4', 11),
  ('c587399a-9c7f-5332-a085-877226becaab', '9b5ac715-4370-545f-a4af-047887a027d8', '35c8152d-2ec1-56b0-a43e-29784b84be72', '719692d9-87c7-5bc1-807c-52cc7080bfe2', 'camera', 0.62, 'high', 'd95f0103-c60a-5a61-9037-5c9be9b89659', 8),
  ('013eda15-008d-5511-a6f5-227d1d16b6f9', 'e5170f82-dbc7-599d-bbc9-5ab7156ac682', '414a9c3b-255b-5e35-a1d3-df540857c944', 'ab53bad2-ac6e-5c1e-abd4-13897b56ea6d', 'manual', null, 'low', '7b0e89bb-6bb3-55d2-a58f-c50ec6307c5c', 9),
  ('a042f096-e2ad-5287-b489-b6f4e258fb3a', '5db5487a-5318-598e-8d71-3d28e032c9d5', '06f37c66-f0a1-57bc-a176-e07d99e50a85', 'c3800013-6073-502d-b1f0-3dc9e3d5fc03', 'camera', 0.83, 'low', '525ab12d-df3b-5181-ba6d-0b7d40cb6518', 7),
  ('c199b96b-dda8-5a05-a026-ed5c9ea7bdd6', '0cc2cb25-677c-5eda-a827-0c5e9b19ee98', '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7', 'a6083e59-ca4e-5206-9c82-e860c014eab0', 'manual', null, 'high', 'a9ab4182-6a56-5403-ae00-2ffcbbad50d7', 18),
  ('695358fa-123f-5a0f-8d92-1beb92be1d47', '0970b397-9a14-5a52-b5b9-bdd37a956cfd', '35c8152d-2ec1-56b0-a43e-29784b84be72', 'ab53bad2-ac6e-5c1e-abd4-13897b56ea6d', 'camera', 0.65, 'low', '49f4ba29-b201-5e55-b7b2-08a46bad8683', 19),
  ('971adf79-16dc-584d-9c86-3bf65dcc207d', 'e5170f82-dbc7-599d-bbc9-5ab7156ac682', '3bf0db99-559d-56b7-8385-7263aee32c64', 'c3800013-6073-502d-b1f0-3dc9e3d5fc03', 'manual', null, 'low', '741dccd6-1acd-577a-a53a-df9301977326', 19),
  ('5db9024c-d400-5b14-9338-127d4a9a3a3d', 'fe9dc7af-dd8b-5be1-91f4-18f664931a27', '06f37c66-f0a1-57bc-a176-e07d99e50a85', 'a6083e59-ca4e-5206-9c82-e860c014eab0', 'camera', 0.77, 'low', '29c18e88-dec8-5368-ac7f-55dbcc3d23d8', 16),
  ('61151c44-eecd-5bd0-af04-964ec508a8a1', 'f7fc6ba6-5c95-54ce-8232-577155d767cb', '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7', '6ecff65c-ff32-5141-83dd-9b51f9953ba2', 'manual', null, 'low', '2d954b00-4d04-5ccf-b150-c206839461ba', 14),
  ('7f3fdf0e-4e35-54f0-a2ad-2c5c8947aada', '4bea76e4-4471-5fac-9ec5-96dc38642691', '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7', 'a6083e59-ca4e-5206-9c82-e860c014eab0', 'camera', 0.67, 'low', '65670c4d-ab3d-5acd-8f85-ebf7c18edbe5', 4),
  ('0d57c65e-a519-5d3d-bc25-699d24fba073', 'fa04e6f8-7364-56f9-9ce3-6031bed2b891', '2d9cf24d-1775-5653-93bb-6bda813c9741', '6ecff65c-ff32-5141-83dd-9b51f9953ba2', 'manual', null, 'high', '70d8cb48-f92f-55f0-8b65-cb0ad0796cb5', 14),
  ('2b29b985-be6d-5ac2-8994-b5e3d9dc1f47', '9b5ac715-4370-545f-a4af-047887a027d8', 'fffb0d67-fc42-55e2-8d9f-a014364f4548', 'a6083e59-ca4e-5206-9c82-e860c014eab0', 'camera', 0.72, 'high', 'ed8f1cbd-fbd0-5124-bf20-c8edcd01b447', 14),
  ('4f8f37bc-d847-549c-ace2-8d205b76a82b', '9e2077a9-228d-5853-a524-463249016d2f', '3bf0db99-559d-56b7-8385-7263aee32c64', 'c3800013-6073-502d-b1f0-3dc9e3d5fc03', 'manual', null, 'high', 'b5cdd357-34ff-561e-b8eb-4b3fefce519e', 15),
  ('045a7ccf-a038-5d42-bc8e-2ef07f1e088e', '402eeb06-7c4c-5b0a-9b2a-fd24ef291dbb', '2d9cf24d-1775-5653-93bb-6bda813c9741', 'c3800013-6073-502d-b1f0-3dc9e3d5fc03', 'camera', 0.9, 'high', 'dd482446-71be-596a-a2ab-10e2971104aa', 2),
  ('837b6f27-0ffb-51e1-8d25-352d82086b8d', '4bea76e4-4471-5fac-9ec5-96dc38642691', '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7', 'ab53bad2-ac6e-5c1e-abd4-13897b56ea6d', 'manual', null, 'high', '026a4132-b3e7-5133-8d64-e7b0cad9f2bf', 4),
  ('ca2935a3-6125-5849-9978-a96dff382d72', '5db5487a-5318-598e-8d71-3d28e032c9d5', '5faaa5c6-3b04-5580-9646-550dccc74ef2', 'a6083e59-ca4e-5206-9c82-e860c014eab0', 'camera', 0.62, 'low', '924d6164-5c9f-522b-9490-5d561999bea8', 11),
  ('ab8b12ce-f3f9-57e5-83eb-2794c6c9edf3', 'f7fc6ba6-5c95-54ce-8232-577155d767cb', '356e6ff6-742a-5ddb-ad79-3ddf0bf9ee2b', 'ab53bad2-ac6e-5c1e-abd4-13897b56ea6d', 'manual', null, 'low', '4b9d6738-5b17-5b83-965a-e1cb122f99cb', 4),
  ('7f5c6a2a-e316-5a22-9831-af8a46d286b4', 'fa04e6f8-7364-56f9-9ce3-6031bed2b891', '2d9cf24d-1775-5653-93bb-6bda813c9741', '6ecff65c-ff32-5141-83dd-9b51f9953ba2', 'camera', 0.69, 'low', '37c4c44c-cafb-5962-970a-45a4c78c5629', 7)
) as t(id, src, who, kit, method, conf, risk, local_id, age)
on conflict (id) do nothing;

insert into reports (id, source_id, test_record_id, risk_level, status, is_re_report, previous_report_id, created_by)
select id::uuid, src::uuid, tr::uuid, 'high', status, re, prev::uuid, who::uuid from (values
  ('f5def4c3-fe95-5c77-84ae-37bdbff50cfe', '5db5487a-5318-598e-8d71-3d28e032c9d5', '2cd5b68d-e4dc-5945-98bc-b80ee4cb15c5', 'action_taken', false, null, '5faaa5c6-3b04-5580-9646-550dccc74ef2'),
  ('57e7ef81-75cd-5adf-ad6e-f736edf760ee', '9b5ac715-4370-545f-a4af-047887a027d8', 'c587399a-9c7f-5332-a085-877226becaab', 'sent_to_lab', false, null, '35c8152d-2ec1-56b0-a43e-29784b84be72'),
  ('c376cad6-9c7c-5792-9dd6-b9202e249ed9', '0cc2cb25-677c-5eda-a827-0c5e9b19ee98', 'c199b96b-dda8-5a05-a026-ed5c9ea7bdd6', 'closed', false, null, '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7'),
  ('888dc41b-d7e2-5f7d-81ea-9c53e2d11aba', 'fa04e6f8-7364-56f9-9ce3-6031bed2b891', '0d57c65e-a519-5d3d-bc25-699d24fba073', 'sent_to_lab', false, null, '2d9cf24d-1775-5653-93bb-6bda813c9741'),
  ('f41dc42e-6189-51d8-99cf-d818ddb1df20', '9b5ac715-4370-545f-a4af-047887a027d8', '2b29b985-be6d-5ac2-8994-b5e3d9dc1f47', 'under_review', false, null, 'fffb0d67-fc42-55e2-8d9f-a014364f4548'),
  ('0203b77a-34f4-5394-ae73-e48c766a791c', '9e2077a9-228d-5853-a524-463249016d2f', '4f8f37bc-d847-549c-ace2-8d205b76a82b', 'closed', false, null, '3bf0db99-559d-56b7-8385-7263aee32c64'),
  ('133b0098-1e20-5478-9f65-35fb8d99966d', '402eeb06-7c4c-5b0a-9b2a-fd24ef291dbb', '045a7ccf-a038-5d42-bc8e-2ef07f1e088e', 'sent_to_lab', false, null, '2d9cf24d-1775-5653-93bb-6bda813c9741'),
  ('96451403-3647-55bb-9a5d-b4fb4c6f5047', '4bea76e4-4471-5fac-9ec5-96dc38642691', '837b6f27-0ffb-51e1-8d25-352d82086b8d', 'open', false, null, '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7'),
  ('10537ddb-8e5a-5e90-bc83-45602f43344e', '5db5487a-5318-598e-8d71-3d28e032c9d5', '2cd5b68d-e4dc-5945-98bc-b80ee4cb15c5', 'closed', true, 'f5def4c3-fe95-5c77-84ae-37bdbff50cfe', '5faaa5c6-3b04-5580-9646-550dccc74ef2'),
  ('c5e7fe9d-e04f-5fbf-a07a-c1184156c11d', '9b5ac715-4370-545f-a4af-047887a027d8', 'c587399a-9c7f-5332-a085-877226becaab', 'action_taken', true, '57e7ef81-75cd-5adf-ad6e-f736edf760ee', '35c8152d-2ec1-56b0-a43e-29784b84be72'),
  ('1c7b1d78-954b-5684-a2c2-4c9826295571', '0cc2cb25-677c-5eda-a827-0c5e9b19ee98', 'c199b96b-dda8-5a05-a026-ed5c9ea7bdd6', 'action_taken', true, 'c376cad6-9c7c-5792-9dd6-b9202e249ed9', '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7')
) as r(id, src, tr, status, re, prev, who)
on conflict (id) do nothing;

update reports set closed_at = now(), closure_reason = 'Demo closure — evidence recorded in seed for illustration.'
  where status = 'closed' and closed_at is null;

insert into lab_referrals (id, report_id, lab_name, verification_status, re_report_requested) values
  ('51a9096f-7b7f-5cb4-b7b8-a5f1ff69d2e4', '1c7b1d78-954b-5684-a2c2-4c9826295571', 'State Water Testing Institute', 'uploaded', true),
  ('b94cc01a-7456-5f6c-b792-23b8c1b4cf8a', 'c376cad6-9c7c-5792-9dd6-b9202e249ed9', 'State Water Testing Institute', 'rejected', false),
  ('672a0650-6b08-559d-af03-eb7d218c141e', '888dc41b-d7e2-5f7d-81ea-9c53e2d11aba', 'State Water Testing Institute', 'uploaded', false),
  ('3023b87b-ad05-5e48-91cd-3cc6ce40f056', '133b0098-1e20-5478-9f65-35fb8d99966d', 'District Public Health Lab', 'pending', false),
  ('09dacfc9-a75c-5726-bc49-bd7bbff4a5a9', 'f41dc42e-6189-51d8-99cf-d818ddb1df20', 'District Public Health Lab', 'rejected', false),
  ('85b2f4ec-3578-5898-913b-36e187992837', '0203b77a-34f4-5394-ae73-e48c766a791c', 'State Water Testing Institute', 'rejected', false),
  ('3ffc55ba-9f73-5dfa-926d-49ab8145718f', 'f5def4c3-fe95-5c77-84ae-37bdbff50cfe', 'State Water Testing Institute', 'rejected', false),
  ('7e3e2bec-770b-530a-a058-b5117e4fd25e', '57e7ef81-75cd-5adf-ad6e-f736edf760ee', 'Clearwater Trust Field Lab', 'rejected', false),
  ('d5472ed0-2277-50db-a7f4-2dbf3ed73ed3', 'c5e7fe9d-e04f-5fbf-a07a-c1184156c11d', 'District Public Health Lab', 'rejected', true),
  ('5340841d-da0d-5e51-bc5e-28861f847951', '10537ddb-8e5a-5e90-bc83-45602f43344e', 'State Water Testing Institute', 'uploaded', true)
on conflict (id) do nothing;

insert into process_photos (report_id, source_id, photo_url, process_stage, inspection_level, uploaded_by)
select rep::uuid, src::uuid, url, stage, lvl, who::uuid from (values
  ('888dc41b-d7e2-5f7d-81ea-9c53e2d11aba', 'fa04e6f8-7364-56f9-9ce3-6031bed2b891', 'demo://photos/process_1.jpg', 'initial_capture', 'field', '2d9cf24d-1775-5653-93bb-6bda813c9741'),
  ('c5e7fe9d-e04f-5fbf-a07a-c1184156c11d', '9b5ac715-4370-545f-a4af-047887a027d8', 'demo://photos/process_2.jpg', 'closure', 'supervisor', '35c8152d-2ec1-56b0-a43e-29784b84be72'),
  ('0203b77a-34f4-5394-ae73-e48c766a791c', '9e2077a9-228d-5853-a524-463249016d2f', 'demo://photos/process_3.jpg', 'initial_capture', 'field', '3bf0db99-559d-56b7-8385-7263aee32c64'),
  ('f5def4c3-fe95-5c77-84ae-37bdbff50cfe', '5db5487a-5318-598e-8d71-3d28e032c9d5', 'demo://photos/process_4.jpg', 'closure', 'lab', '5faaa5c6-3b04-5580-9646-550dccc74ef2'),
  ('10537ddb-8e5a-5e90-bc83-45602f43344e', '5db5487a-5318-598e-8d71-3d28e032c9d5', 'demo://photos/process_5.jpg', 'closure', 'supervisor', '5faaa5c6-3b04-5580-9646-550dccc74ef2'),
  ('f5def4c3-fe95-5c77-84ae-37bdbff50cfe', '5db5487a-5318-598e-8d71-3d28e032c9d5', 'demo://photos/process_6.jpg', 'closure', 'supervisor', '5faaa5c6-3b04-5580-9646-550dccc74ef2'),
  ('c376cad6-9c7c-5792-9dd6-b9202e249ed9', '0cc2cb25-677c-5eda-a827-0c5e9b19ee98', 'demo://photos/process_7.jpg', 'initial_capture', 'field', '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7'),
  ('c5e7fe9d-e04f-5fbf-a07a-c1184156c11d', '9b5ac715-4370-545f-a4af-047887a027d8', 'demo://photos/process_8.jpg', 'initial_capture', 'field', '35c8152d-2ec1-56b0-a43e-29784b84be72'),
  ('1c7b1d78-954b-5684-a2c2-4c9826295571', '0cc2cb25-677c-5eda-a827-0c5e9b19ee98', 'demo://photos/process_9.jpg', 'lab_referral', 'lab', '3dbbb5f3-6ebf-5da7-b373-a43ad3af00a7'),
  ('57e7ef81-75cd-5adf-ad6e-f736edf760ee', '9b5ac715-4370-545f-a4af-047887a027d8', 'demo://photos/process_10.jpg', 'closure', 'supervisor', '35c8152d-2ec1-56b0-a43e-29784b84be72')
) as ph(rep, src, url, stage, lvl, who)
where not exists (select 1 from process_photos x where x.photo_url = ph.url);

insert into notifications (user_id, recipient_phone, related_report_id, channel, message, sent_at, delivery_status)
select who::uuid, phone, rep::uuid, ch,
       case when ch = 'sms' then 'Update: the water issue you reported has a status change.' else 'Case update on your submitted sample.' end,
       now(), case when ch = 'sms' then 'sent' else 'confirmed' end
from (values
  (null, '+91980000010', 'c5e7fe9d-e04f-5fbf-a07a-c1184156c11d', 'sms'),
  ('5faaa5c6-3b04-5580-9646-550dccc74ef2', null, 'f5def4c3-fe95-5c77-84ae-37bdbff50cfe', 'push'),
  (null, '+91980000002', 'c5e7fe9d-e04f-5fbf-a07a-c1184156c11d', 'sms'),
  ('2d9cf24d-1775-5653-93bb-6bda813c9741', null, '133b0098-1e20-5478-9f65-35fb8d99966d', 'push'),
  (null, '+91980000010', '1c7b1d78-954b-5684-a2c2-4c9826295571', 'sms'),
  ('35c8152d-2ec1-56b0-a43e-29784b84be72', null, 'c5e7fe9d-e04f-5fbf-a07a-c1184156c11d', 'push'),
  (null, '+91980000006', '10537ddb-8e5a-5e90-bc83-45602f43344e', 'sms'),
  ('fffb0d67-fc42-55e2-8d9f-a014364f4548', null, 'f41dc42e-6189-51d8-99cf-d818ddb1df20', 'push'),
  (null, '+91980000011', '888dc41b-d7e2-5f7d-81ea-9c53e2d11aba', 'sms'),
  ('3bf0db99-559d-56b7-8385-7263aee32c64', null, '0203b77a-34f4-5394-ae73-e48c766a791c', 'push')
) as n(who, phone, rep, ch)
where not exists (select 1 from notifications);

-- Complaints #1-5 stay 'new' (+10), #6-10 escalated (+10 +100), #11-15 escalated and resolved (+10 +100 +50).
insert into complaints (id, submitted_by, source_id, complaint_type, details, status)
select c.id::uuid, pa.profile_id, c.src::uuid, c.ctype,
       jsonb_build_object('description', 'Resident-reported ' || c.ctype || ' issue, demo complaint #' || c.n || '.'), 'new'
from (values
  (1, '98501d94-86eb-52dd-8279-a5a48f266bac', 'b6e646c2-45e0-504e-9f12-44c1ac18bb15', 'smell'),
  (2, '9775eb13-564f-5404-b08a-f3cee365aea2', 'fe9dc7af-dd8b-5be1-91f4-18f664931a27', 'sediment'),
  (3, '527a9d35-2f98-51e2-a4bb-b63d4fd453c4', '0cc2cb25-677c-5eda-a827-0c5e9b19ee98', 'other'),
  (4, '89ecb032-9ddc-5bd9-b709-66c11b09fe29', 'f7fc6ba6-5c95-54ce-8232-577155d767cb', 'sediment'),
  (5, '26bee2fa-7427-526d-84c7-f0e40f7f0076', '0970b397-9a14-5a52-b5b9-bdd37a956cfd', 'discoloration'),
  (6, 'af60f63c-6f2b-5c99-b00a-2594c5bf3f05', '5db5487a-5318-598e-8d71-3d28e032c9d5', 'sediment'),
  (7, '3ba23f85-777d-56fb-8b64-fd7613e35ce9', '9e2077a9-228d-5853-a524-463249016d2f', 'discoloration'),
  (8, '60fa61dc-98af-53e4-af7f-511bb9658785', 'e5170f82-dbc7-599d-bbc9-5ab7156ac682', 'smell'),
  (9, '53ec65e3-4693-58c1-ad89-b2a029dd415f', 'fe9dc7af-dd8b-5be1-91f4-18f664931a27', 'taste'),
  (10, 'd02107ed-2a0b-5a7a-b548-dda67b907e4b', '9b5ac715-4370-545f-a4af-047887a027d8', 'taste'),
  (11, '0ce5ef8e-898f-5eda-8363-9d0269de78ba', '4bea76e4-4471-5fac-9ec5-96dc38642691', 'smell'),
  (12, 'f69901f7-6117-5de8-8a4d-77dcd5b53643', '15b088a2-0acf-5019-a21c-9cd33baf4f7d', 'taste'),
  (13, 'adccfec3-7ce4-533e-88ec-cc3ffe7d9773', '9e2077a9-228d-5853-a524-463249016d2f', 'sediment'),
  (14, 'c344b8ff-787b-58f5-a5ea-3e0be27d8b22', '0cc2cb25-677c-5eda-a827-0c5e9b19ee98', 'other'),
  (15, 'f029539e-a6ac-5b8d-b0f1-5b30829685f6', 'e5170f82-dbc7-599d-bbc9-5ab7156ac682', 'illness')
) as c(n, id, src, ctype)
join public_accounts pa on pa.phone = '+919800000' || lpad(c.n::text, 2, '0')
on conflict (id) do nothing;

update complaints set status = 'escalated' where id in (
  'af60f63c-6f2b-5c99-b00a-2594c5bf3f05', '3ba23f85-777d-56fb-8b64-fd7613e35ce9', '60fa61dc-98af-53e4-af7f-511bb9658785',
  '53ec65e3-4693-58c1-ad89-b2a029dd415f', 'd02107ed-2a0b-5a7a-b548-dda67b907e4b', '0ce5ef8e-898f-5eda-8363-9d0269de78ba',
  'f69901f7-6117-5de8-8a4d-77dcd5b53643', 'adccfec3-7ce4-533e-88ec-cc3ffe7d9773', 'c344b8ff-787b-58f5-a5ea-3e0be27d8b22',
  'f029539e-a6ac-5b8d-b0f1-5b30829685f6');

update complaints c set linked_report_id = l.rep::uuid from (values
  ('0ce5ef8e-898f-5eda-8363-9d0269de78ba', '1c7b1d78-954b-5684-a2c2-4c9826295571'),
  ('f69901f7-6117-5de8-8a4d-77dcd5b53643', '57e7ef81-75cd-5adf-ad6e-f736edf760ee'),
  ('adccfec3-7ce4-533e-88ec-cc3ffe7d9773', 'f5def4c3-fe95-5c77-84ae-37bdbff50cfe'),
  ('c344b8ff-787b-58f5-a5ea-3e0be27d8b22', 'f41dc42e-6189-51d8-99cf-d818ddb1df20'),
  ('f029539e-a6ac-5b8d-b0f1-5b30829685f6', 'c5e7fe9d-e04f-5fbf-a07a-c1184156c11d')
) as l(cid, rep) where c.id = l.cid::uuid;

update reports set status = 'closed', closed_at = now(), closure_reason = 'Demo resolution for points-trigger verification.'
  where id in ('1c7b1d78-954b-5684-a2c2-4c9826295571', '57e7ef81-75cd-5adf-ad6e-f736edf760ee',
               'f5def4c3-fe95-5c77-84ae-37bdbff50cfe', 'f41dc42e-6189-51d8-99cf-d818ddb1df20',
               'c5e7fe9d-e04f-5fbf-a07a-c1184156c11d');

insert into sponsors (id, company_name, sponsorship_tier) values
  ('c18fdf1e-568f-51c1-bce6-19736f690524', 'BlueDrop Filters Co.', 'gold'),
  ('aa4b1940-36de-509c-8426-78cc4596458b', 'Sahyadri Beverages Ltd.', 'silver'),
  ('8e5a539f-a8e5-57b2-8734-23ece98edf94', 'AquaPure Solutions', 'bronze')
on conflict (id) do nothing;

insert into sponsor_rewards (id, sponsor_id, reward_title, points_required, quantity_available) values
  ('80b675df-276d-5e47-9757-0875c4d3ff13', 'c18fdf1e-568f-51c1-bce6-19736f690524', 'Home Water Filter Cartridge', 100, 50),
  ('785b8bb9-af9e-5560-bff8-92e65ad08393', 'aa4b1940-36de-509c-8426-78cc4596458b', 'Reusable Steel Water Bottle', 40, 200),
  ('a462382b-d606-5594-9674-5eebe7f8f424', '8e5a539f-a8e5-57b2-8734-23ece98edf94', 'Free Home Water Test Kit', 60, 100),
  ('ec049dd8-4288-5823-bce8-55f96ec510da', 'c18fdf1e-568f-51c1-bce6-19736f690524', 'Grocery Voucher (₹100)', 150, 30),
  ('b8b66141-4ba4-5393-ba49-2e1b80761538', 'aa4b1940-36de-509c-8426-78cc4596458b', 'JalSakshi Volunteer T-Shirt', 25, 150)
on conflict (id) do nothing;

-- Complaints #11-13 went through submit -> verify -> resolve (160 points each).
select redeem_reward(pa.profile_id, '80b675df-276d-5e47-9757-0875c4d3ff13')
from public_accounts pa
where pa.phone in ('+91980000011', '+91980000012', '+91980000013')
  and not exists (select 1 from reward_redemptions rr where rr.profile_id = pa.profile_id);

refresh materialized view public_map_view;

commit;
