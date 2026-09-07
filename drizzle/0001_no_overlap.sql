-- Zero-delay double-booking prevention (PROJECT_BRIEF.md §3).
--
-- The whole point of this constraint is that the *database* rejects a
-- conflicting write atomically. Two front-desk devices signed in to the same
-- shared account, or an agent and a front-desk person hitting Submit in the
-- same millisecond, cannot both succeed: one of them gets SQLSTATE 23P01 and
-- the app turns that into "ce créneau vient d'être réservé sur un autre poste".
--
-- 0000_init already added a partial UNIQUE index on (salon, date, start_min),
-- which covers the common "same slot" collision. This adds the stronger
-- guarantee: no two non-cancelled bookings in the same salon on the same day
-- may have *overlapping* [start, start + duration) minute ranges, so a 90
-- minute coloration correctly blocks the two slots behind it as well.
--
-- btree_gist is what lets a GiST exclusion constraint mix plain equality
-- columns (salon_id, booking_date) with a range operator. It ships with Neon.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "salon_id" WITH =,
    "booking_date" WITH =,
    int4range("start_min", "start_min" + "duration_min") WITH &&
  )
  WHERE ("status" <> 'cancelled');
