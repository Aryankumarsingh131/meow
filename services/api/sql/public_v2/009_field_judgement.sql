-- JalSakshi public v2 — 009: more field judgement (owner request, 2026-09-26).
--  * test_kits.protocol: the step-by-step protocol Pluccy walks through per kit.
--  * inspection_criteria: the checklist a field worker answers at the source -
--    a sanitary inspection (WHO-style risk questions) and visual/reported
--    observations. Config-driven; the API scores it (public_v2.judge).
--  * test_records.inspection: the answers given for one screening.
--  * Two more kits: a 6-in-1 multi-parameter strip and a turbidity tube.
-- Screening bands stay screening bands: nothing here is a laboratory result.
-- Order: ... -> 008 -> 009. Idempotent.

begin;

alter table test_kits add column if not exists protocol jsonb not null default '[]'::jsonb;
alter table test_records add column if not exists inspection jsonb;

create table if not exists inspection_criteria (
  key       text primary key check (key ~ '^[a-z_]{2,40}$'),
  category  text not null check (category in ('sanitary', 'observation')),
  question  text not null,
  tip       text not null,
  position  int not null default 0
);
alter table inspection_criteria enable row level security;

insert into inspection_criteria (key, category, question, tip, position) values
  ('latrine_nearby', 'sanitary', 'Is there a latrine, soak pit or septic tank within 10 m?', 'Pace it out: about 12 of your steps.', 1),
  ('animal_waste', 'sanitary', 'Is there animal dung or waste within 10 m?', 'Look around the whole source, not only the spout.', 2),
  ('standing_water', 'sanitary', 'Is water pooling around the source?', 'Pools let dirty water seep back down the pipe or well.', 3),
  ('damaged_platform', 'sanitary', 'Is the platform or apron cracked, broken or missing?', 'Check the joint between the pump and the concrete too.', 4),
  ('drainage_broken', 'sanitary', 'Is the drain channel broken, blocked or missing?', 'Water should run away from the source, not sit beside it.', 5),
  ('open_or_loose', 'sanitary', 'Is the well open, or is the pump loose on its base?', 'Rock the pump gently; it should not move.', 6),
  ('garbage_nearby', 'sanitary', 'Is garbage or refuse dumped within 10 m?', 'Include piles hidden behind walls or bushes.', 7),
  ('recent_flooding', 'sanitary', 'Has the source flooded in the last month?', 'Ask the people collecting water if you are not sure.', 8),
  ('colour_change', 'observation', 'Does the water look coloured (brown, yellow, green)?', 'Look through a clear bottle against a white sheet.', 1),
  ('odour', 'observation', 'Does the water smell unusual?', 'Smell straight after filling; odours fade quickly.', 2),
  ('visible_particles', 'observation', 'Can you see particles or cloudiness?', 'Let the bottle stand one minute and look again.', 3),
  ('taste_reports', 'observation', 'Do residents report an odd taste?', 'Ask two or three people, not just one.', 4),
  ('illness_reports', 'observation', 'Do residents report stomach illness after drinking?', 'Any yes here raises the case for your supervisor straight away.', 5)
on conflict (key) do update set category = excluded.category, question = excluded.question, tip = excluded.tip,
  position = excluded.position;

-- The collection steps every kit shares, then the kit's own steps.
update test_kits set protocol = jsonb_build_array(
    jsonb_build_object('title', 'Wear gloves', 'detail', 'Clean gloves for every source, so your hands do not contaminate the sample.'),
    jsonb_build_object('title', 'Flush the source', 'detail', 'Run the tap or pump for one minute before collecting.'),
    jsonb_build_object('title', 'Rinse the container', 'detail', 'Rinse the sample bottle three times with the source water, then fill it.'),
    jsonb_build_object('title', 'Check the kit', 'detail', 'Kit in date, strips dry, the pot closed right after taking a strip.')
  ) || case strip_type
    when 'coliform' then jsonb_build_array(
      jsonb_build_object('title', 'Fill to the line', 'detail', 'Fill the vial exactly to the line; too much or too little changes the result.'),
      jsonb_build_object('title', 'Keep it warm', 'detail', 'Keep the vial upright near body temperature until it is read.'))
    when 'TDS' then jsonb_build_array(
      jsonb_build_object('title', 'Calibrate', 'detail', 'Zero the meter in clean water before the sample.'))
    else jsonb_build_array(
      jsonb_build_object('title', 'Do not touch the pads', 'detail', 'Hold the strip by its end; skin oil changes the colours.'))
  end
  where protocol = '[]'::jsonb;

-- Two more kits.
insert into test_kits (name, strip_type, icon_ref, timing_window_sec, read_grace_sec, dip_instruction, active)
select 'AquaCheck 6-in-1 Strip', 'multi', 'icon_multi_strip', 60, 60,
       'Dip for 2 seconds with every pad under water, shake off once, hold flat with pads up.', true
where not exists (select 1 from test_kits where name = 'AquaCheck 6-in-1 Strip');
insert into test_kits (name, strip_type, icon_ref, timing_window_sec, read_grace_sec, dip_instruction, active)
select 'Turbidity Tube', 'turbidity', 'icon_turbidity_tube', 10, 120,
       'Fill the tube to the top mark, let it settle, then look down through it at the mark on the base.', true
where not exists (select 1 from test_kits where name = 'Turbidity Tube');

insert into kit_parameters (kit_id, parameter, position)
  select k.id, p.param, p.pos from test_kits k
  join (values ('ph', 1), ('chlorine', 2), ('iron', 3), ('hardness', 4), ('nitrate', 5), ('fluoride', 6)) as p(param, pos)
    on k.name = 'AquaCheck 6-in-1 Strip'
  on conflict do nothing;
insert into kit_parameters (kit_id, parameter, position)
  select id, 'turbidity', 1 from test_kits where name = 'Turbidity Tube'
  on conflict do nothing;

update test_kits set protocol = jsonb_build_array(
    jsonb_build_object('title', 'Wear gloves', 'detail', 'Clean gloves for every source.'),
    jsonb_build_object('title', 'Flush the source', 'detail', 'Run the tap or pump for one minute before collecting.'),
    jsonb_build_object('title', 'Rinse the container', 'detail', 'Rinse three times with the source water, then fill.'),
    jsonb_build_object('title', 'Read in order', 'detail', 'Read the pads top to bottom against the chart; chlorine fades first.'))
  where name = 'AquaCheck 6-in-1 Strip' and protocol = '[]'::jsonb;
update test_kits set protocol = jsonb_build_array(
    jsonb_build_object('title', 'Flush the source', 'detail', 'Run the tap or pump for one minute before collecting.'),
    jsonb_build_object('title', 'Shade and white card', 'detail', 'Stand in shade and hold the tube over a white card.'),
    jsonb_build_object('title', 'Read the line', 'detail', 'Pour out slowly until the mark on the base just appears; read the level.'))
  where name = 'Turbidity Tube' and protocol = '[]'::jsonb;

revoke all on all tables in schema public from anon, authenticated;
grant select (id, full_name, email, phone, created_at) on residents to authenticated;
grant select (id, reference_number, complaint_type, details, status, resolution, source_id, submitted_at, linked_at)
  on complaints to authenticated;

commit;
