-- 011: more than one photo per complaint and per screening (2026-09-26, owner request).
--
-- photo_url stays the FIRST photo (the points rule and every existing reader use
-- it); extra_photo_urls holds up to 3 more 'blob:<uuid>' references, stored and
-- inspected exactly like the first (app/public_v2.store_upload). Staff-only:
-- residents are not granted these columns. A complaint's extra problem types
-- live in details->'also' (residents may already read details).

alter table complaints add column if not exists extra_photo_urls text[] not null default '{}';
alter table complaints drop constraint if exists chk_complaint_extra_photos;
alter table complaints add constraint chk_complaint_extra_photos
  check (cardinality(extra_photo_urls) <= 3 and (cardinality(extra_photo_urls) = 0 or photo_url is not null));

alter table test_records add column if not exists extra_photo_urls text[] not null default '{}';
alter table test_records drop constraint if exists chk_test_extra_photos;
alter table test_records add constraint chk_test_extra_photos
  check (cardinality(extra_photo_urls) <= 3 and (cardinality(extra_photo_urls) = 0 or photo_url is not null));
