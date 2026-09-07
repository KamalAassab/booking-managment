-- ============================================================
-- Atelier Planning - complete one-shot setup for a fresh database.
--
-- Paste the whole file into the Neon console's SQL Editor and press Run.
-- It does exactly what `npm run db:migrate` then `npm run db:seed` would,
-- including recording the migrations so a later db:migrate does not try to
-- re-apply them.
--
-- Re-running it is safe and does nothing the second time: every statement is
-- guarded, salons are upserted, and existing accounts are left untouched so
-- a password you have already changed is never reset.
-- ============================================================

BEGIN;

-- ---------- 0000_init ----------
DO $$ BEGIN
  CREATE TYPE "public"."booking_channel" AS ENUM('call_center', 'front_desk');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'cancelled', 'done');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."user_role" AS ENUM('staff', 'owner');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS "bookings" (
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
CREATE TABLE IF NOT EXISTS "salons" (
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
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "bookings_salon_date_idx" ON "bookings" USING btree ("salon_id","booking_date","start_min");
CREATE INDEX IF NOT EXISTS "bookings_updated_at_idx" ON "bookings" USING btree ("updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_slot_unique" ON "bookings" USING btree ("salon_id","booking_date","start_min") WHERE status <> 'cancelled';

-- ---------- 0001_no_overlap ----------
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_no_overlap"
    EXCLUDE USING gist (
      "salon_id" WITH =,
      "booking_date" WITH =,
      int4range("start_min", "start_min" + "duration_min") WITH &&
    )
    WHERE ("status" <> 'cancelled');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ---------- 0002_guards ----------
DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_within_day" CHECK ("bookings"."start_min" + "bookings"."duration_min" <= 1440);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_name_present" CHECK (length(btrim("bookings"."client_name")) > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_present" CHECK (length(btrim("bookings"."service")) > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salons" ADD CONSTRAINT "salons_hours_ordered" CHECK ("salons"."opens_at_min" >= 0 AND "salons"."closes_at_min" <= 1440 AND "salons"."opens_at_min" < "salons"."closes_at_min");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salons" ADD CONSTRAINT "salons_slot_positive" CHECK ("salons"."slot_min" > 0 AND "salons"."slot_min" <= 480);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ---------- migration bookkeeping ----------
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT v.hash, v.created_at FROM (VALUES
  ('b1eb1e8043c08e8bba45e7278c8bc30adaebc768785eb9c6ac2a22280d5e4e6b'::text, 1788820207672::bigint),
  ('ad432eb7fe4ee829b09625c3cb85feed238c7950e094de8dad2e661da91d06cb'::text, 1788820215494::bigint),
  ('e15f90621ff9b8333cae0601b975ed1fb6a9c62acab58c642b9b61908198810f'::text, 1788823025316::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" m WHERE m.hash = v.hash
);

-- ---------- salons ----------
INSERT INTO "salons" (slug, name, sort_order, opens_at_min, closes_at_min, slot_min) VALUES
  ('vip',    'L''Atelier VIP',               0, 540, 1200, 30),
  ('gold',   'L''Atelier Gold',              1, 540, 1200, 30),
  ('barber', 'L''Atelier Barber Shop & Spa', 2, 540, 1260, 30)
ON CONFLICT (slug) DO UPDATE SET
  name          = EXCLUDED.name,
  sort_order    = EXCLUDED.sort_order,
  opens_at_min  = EXCLUDED.opens_at_min,
  closes_at_min = EXCLUDED.closes_at_min,
  slot_min      = EXCLUDED.slot_min;

-- ---------- accounts ----------
-- scrypt hashes for the two initial passwords; the passwords themselves are
-- not recoverable from this file. Change both from the owner screen once you
-- are signed in.
INSERT INTO "users" (username, role, password_hash) VALUES
  ('staff', 'staff', 'scrypt$16384$8$1$0tdhPmtJAs4r7srvY1SlAg==$WT6CG7NATMtBWfGMcKRDFE8+eRcoj+6hE0uLtO+UxYYVLFj0SY8y6J3zrFl527OWTO4T6T1b45+rApE8qKvCfQ=='),
  ('owner', 'owner', 'scrypt$16384$8$1$5D/HtTWpOBbQy/ITqATdHQ==$MnhJ9+IDbOJwHEsyfxxN03yJ4nPHHQNVR7vb9QpvvLvPbeU4m67BOI1nXyF5nuR3+UDrQF38e9gCIvGZWTiAlA==')
ON CONFLICT (username) DO NOTHING;

COMMIT;

-- ---------- verification ----------
-- Expect exactly: salons 3, users 2, bookings 0, no_overlap constraint 1.
-- If the constraint row reads 0, double bookings are possible - stop and
-- check why btree_gist could not be created.
SELECT 'salons' AS what, count(*) FROM salons
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'bookings', count(*) FROM bookings
UNION ALL SELECT 'no_overlap constraint', count(*) FROM pg_constraint
  WHERE conname = 'bookings_no_overlap' AND contype = 'x';
