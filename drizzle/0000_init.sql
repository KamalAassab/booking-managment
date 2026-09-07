CREATE TYPE "public"."booking_channel" AS ENUM('call_center', 'front_desk');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'cancelled', 'done');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('staff', 'owner');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"client_name" varchar(120) NOT NULL,
	"client_phone" varchar(20) NOT NULL,
	"booking_date" date NOT NULL,
	"start_min" integer NOT NULL,
	"duration_min" integer DEFAULT 30 NOT NULL,
	"service" varchar(120) NOT NULL,
	"notes" text,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"channel" "booking_channel" DEFAULT 'front_desk' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_start_min_range" CHECK ("bookings"."start_min" BETWEEN 0 AND 1439),
	CONSTRAINT "bookings_duration_positive" CHECK ("bookings"."duration_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "salons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(24) NOT NULL,
	"name" varchar(80) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"opens_at_min" integer DEFAULT 540 NOT NULL,
	"closes_at_min" integer DEFAULT 1200 NOT NULL,
	"slot_min" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_salon_date_idx" ON "bookings" USING btree ("salon_id","booking_date","start_min");--> statement-breakpoint
CREATE INDEX "bookings_updated_at_idx" ON "bookings" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_slot_unique" ON "bookings" USING btree ("salon_id","booking_date","start_min") WHERE status <> 'cancelled';