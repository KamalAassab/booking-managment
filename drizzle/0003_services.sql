-- Services catalogue per salon.
-- The owner can edit names, prices, and durations from /owner/services.
-- Seeds from lib/services-catalog.ts on first npm run db:seed.

CREATE TABLE "services" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "salon_id"     uuid        NOT NULL REFERENCES "salons"("id") ON DELETE CASCADE,
  "category"     varchar(120) NOT NULL,
  "name"         varchar(200) NOT NULL,
  "duration_min" integer     NOT NULL DEFAULT 30,
  "price"        integer     NOT NULL DEFAULT 0,
  "sort_order"   smallint    NOT NULL DEFAULT 0,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "services_duration_positive" CHECK ("duration_min" > 0),
  CONSTRAINT "services_price_non_negative" CHECK ("price" >= 0)
);
--> statement-breakpoint
CREATE INDEX "services_salon_sort_idx" ON "services" ("salon_id", "sort_order");
