CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"category" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"duration_min" integer DEFAULT 30 NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_duration_positive" CHECK ("services"."duration_min" > 0),
	CONSTRAINT "services_price_non_negative" CHECK ("services"."price" >= 0)
);
--> statement-breakpoint
DROP INDEX "bookings_slot_unique";--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_salon_sort_idx" ON "services" USING btree ("salon_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_slot_unique" ON "bookings" USING btree ("salon_id","booking_date",lower(btrim("service")),"start_min") WHERE status <> 'cancelled';