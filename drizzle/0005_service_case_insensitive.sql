-- One chair per service, however the service name is capitalised or spaced.
--
-- 0004 made the double-booking rule "per service", comparing names exactly.
-- Catalogue services always match exactly, but a custom service is free text
-- typed by staff: "Coupe enfant" and "coupe enfant" are the same chair, and
-- the booking sheet's own conflict check already treats them as one — yet the
-- database accepted both at 10:00, so two agents could sell that chair twice.
--
-- The whole change is one DO block on purpose. On Neon the migrator sends each
-- statement on its own, outside any transaction; dropping the old constraint
-- in one statement and failing to add the new one in the next would leave the
-- bookings table with no double-booking protection at all. A DO block is a
-- single statement, so this is all-or-nothing on every driver: the stricter
-- definitions are built first, and the old ones only go once they exist.
--
-- If this fails with "could not create unique index" or "could not create
-- exclusion constraint", the table already holds live bookings that the
-- stricter rule calls a double booking. List them, cancel one of each pair,
-- and run the migration again:
--
--   select a.id, b.id, a.booking_date, a.start_min, a.service, b.service
--     from bookings a join bookings b
--       on a.salon_id = b.salon_id and a.booking_date = b.booking_date
--      and lower(btrim(a.service)) = lower(btrim(b.service)) and a.id < b.id
--    where a.status <> 'cancelled' and b.status <> 'cancelled'
--      and int4range(a.start_min, a.start_min + a.duration_min)
--       && int4range(b.start_min, b.start_min + b.duration_min);

DO $$
BEGIN
  CREATE UNIQUE INDEX "bookings_slot_unique_ci" ON "bookings"
    ("salon_id", "booking_date", lower(btrim("service")), "start_min")
    WHERE ("status" <> 'cancelled');

  ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_no_overlap_ci"
    EXCLUDE USING gist (
      "salon_id" WITH =,
      "booking_date" WITH =,
      (lower(btrim("service"))) WITH =,
      int4range("start_min", "start_min" + "duration_min") WITH &&
    )
    WHERE ("status" <> 'cancelled');

  ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";
  DROP INDEX IF EXISTS "bookings_slot_unique";

  ALTER TABLE "bookings" RENAME CONSTRAINT "bookings_no_overlap_ci" TO "bookings_no_overlap";
  ALTER INDEX "bookings_slot_unique_ci" RENAME TO "bookings_slot_unique";
END $$;
