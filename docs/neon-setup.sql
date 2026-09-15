-- ============================================================
-- Atelier Planning - complete one-shot setup for a fresh database.
--
-- Paste the whole file into the Neon console's SQL Editor and press Run.
-- It does exactly what `npm run db:migrate` then `npm run db:seed` would,
-- including recording the migrations so a later db:migrate does not try to
-- re-apply them.
--
-- Re-running it is safe: every statement is guarded, salons are upserted,
-- a salon's service catalogue is only seeded while it has none, and existing
-- accounts are left untouched so a password you have already changed is
-- never reset. Re-running it on a database set up with an older copy of this
-- file also upgrades that database to the current double-booking rule.
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
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_slot_unique" ON "bookings" ("salon_id", "booking_date", lower(btrim("service")), "start_min") WHERE ("status" <> 'cancelled');

-- ---------- 0001_no_overlap ----------
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_no_overlap"
    EXCLUDE USING gist (
      "salon_id" WITH =,
      "booking_date" WITH =,
      (lower(btrim("service"))) WITH =,
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

-- ---------- 0003_services ----------
CREATE TABLE IF NOT EXISTS "services" (
  "id"           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "salon_id"     uuid         NOT NULL REFERENCES "salons"("id") ON DELETE CASCADE,
  "category"     varchar(120) NOT NULL,
  "name"         varchar(200) NOT NULL,
  "duration_min" integer      NOT NULL DEFAULT 30,
  "price"        integer      NOT NULL DEFAULT 0,
  "sort_order"   smallint     NOT NULL DEFAULT 0,
  "created_at"   timestamptz  NOT NULL DEFAULT now(),
  "updated_at"   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT "services_duration_positive" CHECK ("duration_min" > 0),
  CONSTRAINT "services_price_non_negative" CHECK ("price" >= 0)
);
CREATE INDEX IF NOT EXISTS "services_salon_sort_idx" ON "services" ("salon_id", "sort_order");

-- ---------- 0004 + 0005: one chair per service, ignoring case ----------
-- A database set up with an earlier copy of this file still has the double-
-- booking rule that compares service names exactly. The guards above skip
-- objects that already exist, so the upgrade happens here: the stricter
-- definitions are built first and the old ones dropped only once they exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_no_overlap' AND contype = 'x'
      AND pg_get_constraintdef(oid) LIKE '%lower(btrim(%'
  ) THEN
    DROP INDEX IF EXISTS "bookings_slot_unique_ci";
    CREATE UNIQUE INDEX "bookings_slot_unique_ci" ON "bookings"
      ("salon_id", "booking_date", lower(btrim("service")), "start_min")
      WHERE ("status" <> 'cancelled');
    ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap_ci";
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
  END IF;
END $$;

-- ---------- migration bookkeeping ----------
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT v.hash, v.created_at FROM (VALUES
  ('a7c94e2008486ef67e92229208a53ff27c29de1bab56f425981c3e7b3b3434db'::text, 1788820207672::bigint),
  ('287226c31d3c7a5ca40dab45642a45fbd28e75e3c9c8e1cb95ab0664eb236ab1'::text, 1788820215494::bigint),
  ('e46141c88de6aba9fddb1e27636c1dbd07a951a524b07dc6831847f9c5db1bb4'::text, 1788823025316::bigint),
  ('3ccee3555966e77df145f423d7f2367dad34e13747213f9baa019861a42a45ad'::text, 1788824000000::bigint),
  ('ebcbe710218763ca988fcbe6ef755aeebd1ea6d74d23361d3996f4162b3a0a02'::text, 1788825000000::bigint),
  ('5d72386d415f1879d8a0a66271001982cee596e9ee182a0e4e54adc8841d3478'::text, 1788826000000::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" m
  WHERE m.hash = v.hash OR m.created_at = v.created_at
);

-- ---------- salons ----------
INSERT INTO "salons" (slug, name, sort_order, opens_at_min, closes_at_min, slot_min) VALUES
  ('vip',    'L''Atelier VIP',    0, 600, 1320, 30),
  ('gold',   'L''Atelier Gold',   1, 540, 1380, 30),
  ('barber', 'L''Atelier Silver', 2, 540, 1380, 30)
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

-- ---------- service catalogue ----------
-- The same catalogue npm run db:seed writes. A salon that already has
-- services (edited by the owner, or seeded before) is left exactly as it is.
INSERT INTO "services" (salon_id, category, name, duration_min, price, sort_order)
SELECT s.id, v.category, v.name, v.duration_min, v.price, v.sort_order
FROM (VALUES
  ('vip', 'Soins Cheveux', 'Soin Express Brillance', 20, 150, 0),
  ('vip', 'Soins Cheveux', 'Soin Hydratation Intense', 30, 250, 1),
  ('vip', 'Soins Cheveux', 'Soin Nutrition & Douceur', 40, 300, 2),
  ('vip', 'Soins Cheveux', 'Soin Réparateur Kératine', 45, 450, 3),
  ('vip', 'Soins Cheveux', 'Soin Anti-Casse', 35, 350, 4),
  ('vip', 'Soins Cheveux', 'Soin Anti-Frisottis', 45, 450, 5),
  ('vip', 'Soins Cheveux', 'Soin Cheveux Colorés', 30, 300, 6),
  ('vip', 'Soin Protéine', 'Lissage Kératine', 120, 500, 7),
  ('vip', 'Soin Protéine', 'Protéine Botox', 90, 500, 8),
  ('vip', 'Soin Protéine', 'Protéine Basic', 120, 700, 9),
  ('vip', 'Soin Protéine', 'Protéine Moyen Gamme', 150, 900, 10),
  ('vip', 'Soin Protéine', 'Protéine Multivitamine Luxe', 180, 1500, 11),
  ('vip', 'Coloration & techniques', 'Coloration Basic', 60, 250, 12),
  ('vip', 'Coloration & techniques', 'Coloration Sans Ammoniaque', 60, 400, 13),
  ('vip', 'Coloration & techniques', 'Mèches Classiques', 90, 450, 14),
  ('vip', 'Coloration & techniques', 'Balayage Lumière', 120, 600, 15),
  ('vip', 'Coloration & techniques', 'Ombré Hair', 150, 800, 16),
  ('vip', 'Coloration & techniques', 'Coupe + Brushing', 45, 100, 17),
  ('vip', 'Coloration & techniques', 'Brushing Signature', 30, 40, 18),
  ('vip', 'Coloration & techniques', 'Shampoing', 10, 15, 19),
  ('vip', 'Coloration & techniques', 'Shampoing Spécifique', 10, 25, 20),
  ('vip', 'Onglerie', 'Manucure Simple', 30, 50, 21),
  ('vip', 'Onglerie', 'Manucure SPA', 45, 80, 22),
  ('vip', 'Onglerie', 'Manucure de Luxe VIP', 50, 130, 23),
  ('vip', 'Onglerie', 'Bain de Paraffine', 20, 50, 24),
  ('vip', 'Onglerie', 'Pédicure Normale', 45, 100, 25),
  ('vip', 'Onglerie', 'Pédicure SPA', 60, 130, 26),
  ('vip', 'Onglerie', 'Pédicure Médicale VIP + Paraffine', 75, 250, 27),
  ('vip', 'Onglerie', 'Pose Semi-Permanent', 40, 120, 28),
  ('vip', 'Onglerie', 'Semi-Permanent + Manucure Sèche', 60, 150, 29),
  ('vip', 'Onglerie', 'Pose BIAB (Builder In A Bottle)', 60, 220, 30),
  ('vip', 'Onglerie', 'BIAB + Manucure Sèche', 75, 250, 31),
  ('vip', 'Onglerie', 'Pose de Gel', 90, 200, 32),
  ('vip', 'Onglerie', 'Gel + Couleur Permanente', 120, 300, 33),
  ('vip', 'Onglerie', 'Faux Ongles Express', 30, 50, 34),
  ('vip', 'Onglerie', 'Capsules Gel', 45, 90, 35),
  ('vip', 'Onglerie', 'Nail Art ou French', 30, 50, 36),
  ('vip', 'Hammam & Spa', 'Hammam L''Atelier', 45, 150, 37),
  ('vip', 'Hammam & Spa', 'Hammam Royale', 75, 250, 38),
  ('vip', 'Hammam & Spa', 'Hammam VIP', 90, 300, 39),
  ('vip', 'Hammam & Spa', 'Massage Relaxant 45min', 45, 250, 40),
  ('vip', 'Hammam & Spa', 'Massage Relaxant 60min', 60, 300, 41),
  ('vip', 'Hammam & Spa', 'Massage Sportif 45min', 45, 350, 42),
  ('vip', 'Hammam & Spa', 'Massage Sportif 60min', 60, 400, 43),
  ('vip', 'Hammam & Spa', 'Massage Médical 60min', 60, 400, 44),
  ('vip', 'Hammam & Spa', 'Hijama Sec 30min', 30, 150, 45),
  ('vip', 'Hammam & Spa', 'Hijama Sec 60min', 60, 300, 46),
  ('vip', 'Soins Visage', 'Soin Basic Manuel', 40, 150, 47),
  ('vip', 'Soins Visage', 'Soin de Visage Purifiant', 60, 400, 48),
  ('vip', 'Soins Visage', 'Soin de Visage Traitement', 75, 600, 49),
  ('vip', 'Soins Visage', 'Soin de Visage Multivitamine', 90, 800, 50),
  ('vip', 'Soins Visage', 'Soin de Visage Luxe', 90, 1000, 51),
  ('vip', 'Regard', 'Cils par cils en soie', 90, 400, 52),
  ('vip', 'Regard', 'Cils 7D (Volume Russe)', 120, 600, 53),
  ('vip', 'Regard', 'Remplissage Extensions', 60, 200, 54),
  ('vip', 'Regard', 'Dépose Extensions', 30, 100, 55),
  ('vip', 'Regard', 'Browlift', 45, 250, 56),
  ('vip', 'Regard', 'Browlift + Teinture', 60, 300, 57),
  ('vip', 'Regard', 'Lash Lift (Rehaussement)', 50, 300, 58),
  ('vip', 'Regard', 'Lash Lift + Teinture', 60, 300, 59),
  ('vip', 'Épilation', 'Épilation Sourcils', 15, 20, 60),
  ('vip', 'Épilation', 'Coloration Sourcils / Cils', 15, 30, 61),
  ('vip', 'Épilation', 'Épilation Duvet (Lèvres)', 10, 15, 62),
  ('vip', 'Épilation', 'Épilation Menton', 10, 15, 63),
  ('vip', 'Épilation', 'Épilation Narines / Oreilles', 10, 20, 64),
  ('vip', 'Épilation', 'Épilation Visage au fil', 30, 60, 65),
  ('vip', 'Épilation', 'Épilation Visage à la cire', 25, 50, 66),
  ('vip', 'Épilation', 'Épilation Bras complets', 25, 60, 67),
  ('vip', 'Épilation', 'Épilation Demi-bras', 15, 40, 68),
  ('vip', 'Épilation', 'Épilation Aisselles', 10, 30, 69),
  ('vip', 'Épilation', 'Épilation Ventre', 15, 40, 70),
  ('vip', 'Épilation', 'Épilation Dos', 20, 50, 71),
  ('vip', 'Épilation', 'Épilation Jambes complètes', 30, 100, 72),
  ('vip', 'Épilation', 'Épilation Demi-jambes', 15, 50, 73),
  ('vip', 'Épilation', 'Épilation Maillot Cire (Wax)', 20, 100, 74),
  ('vip', 'Épilation', 'Épilation Complète', 60, 300, 75),
  ('gold', 'Soins Cheveux', 'Soin Express Brillance', 20, 150, 0),
  ('gold', 'Soins Cheveux', 'Soin Hydratation Intense', 30, 250, 1),
  ('gold', 'Soins Cheveux', 'Soin Nutrition & Douceur', 40, 300, 2),
  ('gold', 'Soins Cheveux', 'Soin Réparateur Kératine', 45, 450, 3),
  ('gold', 'Soins Cheveux', 'Soin Anti-Casse', 35, 350, 4),
  ('gold', 'Soins Cheveux', 'Soin Anti-Frisottis', 45, 450, 5),
  ('gold', 'Soins Cheveux', 'Soin Cheveux Colorés', 30, 300, 6),
  ('gold', 'Soin Protéine', 'Lissage Kératine', 120, 500, 7),
  ('gold', 'Soin Protéine', 'Protéine Botox', 90, 500, 8),
  ('gold', 'Soin Protéine', 'Protéine Basic', 120, 700, 9),
  ('gold', 'Soin Protéine', 'Protéine Moyen Gamme', 150, 900, 10),
  ('gold', 'Soin Protéine', 'Protéine Multivitamine Luxe', 180, 1500, 11),
  ('gold', 'Coloration & techniques', 'Coloration Basic', 60, 250, 12),
  ('gold', 'Coloration & techniques', 'Coloration Sans Ammoniaque', 60, 400, 13),
  ('gold', 'Coloration & techniques', 'Mèches Classiques', 90, 450, 14),
  ('gold', 'Coloration & techniques', 'Balayage Lumière', 120, 600, 15),
  ('gold', 'Coloration & techniques', 'Ombré Hair', 150, 800, 16),
  ('gold', 'Coloration & techniques', 'Coupe + Brushing', 45, 100, 17),
  ('gold', 'Coloration & techniques', 'Brushing Signature', 30, 40, 18),
  ('gold', 'Coloration & techniques', 'Shampoing', 10, 15, 19),
  ('gold', 'Coloration & techniques', 'Shampoing Spécifique', 10, 25, 20),
  ('gold', 'Onglerie', 'Manucure Simple', 30, 50, 21),
  ('gold', 'Onglerie', 'Manucure SPA', 45, 80, 22),
  ('gold', 'Onglerie', 'Manucure de Luxe VIP', 50, 130, 23),
  ('gold', 'Onglerie', 'Bain de Paraffine', 20, 50, 24),
  ('gold', 'Onglerie', 'Pédicure Normale', 45, 100, 25),
  ('gold', 'Onglerie', 'Pédicure SPA', 60, 130, 26),
  ('gold', 'Onglerie', 'Pédicure Médicale VIP + Paraffine', 75, 250, 27),
  ('gold', 'Onglerie', 'Pose Semi-Permanent', 40, 120, 28),
  ('gold', 'Onglerie', 'Semi-Permanent + Manucure Sèche', 60, 150, 29),
  ('gold', 'Onglerie', 'Pose BIAB (Builder In A Bottle)', 60, 220, 30),
  ('gold', 'Onglerie', 'BIAB + Manucure Sèche', 75, 250, 31),
  ('gold', 'Onglerie', 'Pose de Gel', 90, 200, 32),
  ('gold', 'Onglerie', 'Gel + Couleur Permanente', 120, 300, 33),
  ('gold', 'Onglerie', 'Faux Ongles Express', 30, 50, 34),
  ('gold', 'Onglerie', 'Capsules Gel', 45, 90, 35),
  ('gold', 'Onglerie', 'Nail Art ou French', 30, 50, 36),
  ('barber', 'Coiffure & Barbe', 'Coupe Stylisée + Taille de Barbe', 45, 70, 0),
  ('barber', 'Coiffure & Barbe', 'Barbe Traditionnelle & Vapeur', 25, 30, 1),
  ('barber', 'Coiffure & Barbe', 'Coupe Simple', 25, 40, 2),
  ('barber', 'Coiffure & Barbe', 'Coupe Enfant (-12 ans)', 20, 30, 3),
  ('barber', 'Coiffure & Barbe', 'Brushing Homme', 15, 20, 4),
  ('barber', 'Services Spéciaux', 'Soin Visage Basic', 35, 150, 5),
  ('barber', 'Services Spéciaux', 'Soin Hydrafacial Pro', 50, 300, 6),
  ('barber', 'Services Spéciaux', 'Massage Relaxant Corps', 45, 200, 7),
  ('barber', 'Services Spéciaux', 'Hijama Sec Traditionnel', 30, 150, 8),
  ('barber', 'Extra Services', 'Shampooing', 10, 15, 9),
  ('barber', 'Extra Services', 'Gommage Visage', 15, 40, 10),
  ('barber', 'Extra Services', 'Épilation Visage au fil', 20, 60, 11),
  ('barber', 'Extra Services', 'Protéine Basic Homme', 60, 150, 12),
  ('barber', 'Extra Services', 'Protéine Luxe Homme', 90, 600, 13),
  ('barber', 'Spa & Soins Homme', 'Hammam Turc', 45, 130, 14),
  ('barber', 'Spa & Soins Homme', 'Hammam Royale Homme', 60, 200, 15),
  ('barber', 'Spa & Soins Homme', 'Hammam Silver d''Exception', 75, 250, 16),
  ('barber', 'Spa & Soins Homme', 'Pédicure Médicale Homme', 50, 200, 17),
  ('barber', 'Spa & Soins Homme', 'Manucure Homme', 30, 50, 18)
) AS v(slug, category, name, duration_min, price, sort_order)
JOIN "salons" s ON s.slug = v.slug
WHERE NOT EXISTS (SELECT 1 FROM "services" x WHERE x.salon_id = s.id);

COMMIT;

-- ---------- verification ----------
-- Expect: salons 3, users 2, services 132 on a fresh database,
-- bookings 0, and the case-insensitive no_overlap constraint 1. If that last
-- row reads 0, double bookings are possible - stop and check why btree_gist
-- could not be created.
SELECT 'salons' AS what, count(*) FROM salons
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'services', count(*) FROM services
UNION ALL SELECT 'bookings', count(*) FROM bookings
UNION ALL SELECT 'no_overlap constraint (case-insensitive)', count(*) FROM pg_constraint
  WHERE conname = 'bookings_no_overlap' AND contype = 'x'
    AND pg_get_constraintdef(oid) LIKE '%lower(btrim(%';
