-- An appointment can now hold more than one service (brief update). Each
-- service becomes its own row in booking_services, occupying its own slice
-- of the visit, back to back — the double-booking guarantee moves from
-- bookings.service to here, unchanged in spirit: a service name still stands
-- for the one chair/station that does it, so two different services may run
-- at once, but the same service may not.
--
-- Order matters below: the backfill must run while bookings.service still
-- exists, and every constraint that depends on it must be dropped before the
-- column itself is, or the drop fails with rows still enforcing it.

CREATE TABLE "booking_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"salon_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"service" varchar(120) NOT NULL,
	"start_min" integer NOT NULL,
	"duration_min" integer NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_services_start_min_range" CHECK ("booking_services"."start_min" BETWEEN 0 AND 1439),
	CONSTRAINT "booking_services_duration_positive" CHECK ("booking_services"."duration_min" > 0),
	CONSTRAINT "booking_services_within_day" CHECK ("booking_services"."start_min" + "booking_services"."duration_min" <= 1440),
	CONSTRAINT "booking_services_price_non_negative" CHECK ("booking_services"."price" >= 0),
	CONSTRAINT "booking_services_service_present" CHECK (length(btrim("booking_services"."service")) > 0)
);
--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- One row per existing booking, carrying over its single service exactly as
-- it was booked. Price is looked up from the salon's catalogue by name
-- (case/space-insensitive, like every other service comparison in this app)
-- since bookings never stored one; unmatched or custom services get 0, same
-- as a fresh custom service does today.
INSERT INTO "booking_services"
  ("id", "booking_id", "salon_id", "booking_date", "status", "service", "start_min", "duration_min", "price", "sort_order", "created_at")
SELECT
  gen_random_uuid(), b."id", b."salon_id", b."booking_date", b."status", b."service", b."start_min", b."duration_min",
  coalesce(s."price", 0), 0, b."created_at"
FROM "bookings" b
LEFT JOIN "services" s
  ON s."salon_id" = b."salon_id" AND lower(btrim(s."name")) = lower(btrim(b."service"));
--> statement-breakpoint
CREATE INDEX "booking_services_booking_idx" ON "booking_services" USING btree ("booking_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_services_slot_unique" ON "booking_services" USING btree ("salon_id","booking_date",lower(btrim("service")),"start_min") WHERE status <> 'cancelled';
--> statement-breakpoint
-- btree_gist already exists (added in 0001_no_overlap); repeated here only so
-- this migration is not silently dependent on that earlier one having run.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "booking_services"
  ADD CONSTRAINT "booking_services_no_overlap"
  EXCLUDE USING gist (
    "salon_id" WITH =,
    "booking_date" WITH =,
    (lower(btrim("service"))) WITH =,
    int4range("start_min", "start_min" + "duration_min") WITH &&
  )
  WHERE ("status" <> 'cancelled');
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_service_present";
--> statement-breakpoint
DROP INDEX "bookings_slot_unique";
--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "service";
