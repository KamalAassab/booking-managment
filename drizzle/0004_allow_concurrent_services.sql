-- Allow multiple bookings at the same time if they have different services.
-- Overlap prevention applies per salon, per date, per service.

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";
--> statement-breakpoint
DROP INDEX IF EXISTS "bookings_slot_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_slot_unique" ON "bookings" ("salon_id", "booking_date", "service", "start_min") WHERE ("status" <> 'cancelled');
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "salon_id" WITH =,
    "booking_date" WITH =,
    "service" WITH =,
    int4range("start_min", "start_min" + "duration_min") WITH &&
  )
  WHERE ("status" <> 'cancelled');
