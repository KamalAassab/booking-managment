-- Constraints that close the gaps 0000 left open.
--
-- Each of these was reachable from the application before this migration:
--
--  * bookings_within_day — a 23:00 booking of two hours stored the range
--    int4range(1380, 1500). The exclusion constraint only ever compares rows
--    that share a booking_date, so the two hours that booking really occupies
--    on the following morning were invisible to it and could be sold twice.
--
--  * bookings_client_name_present / bookings_service_present — a name of
--    spaces passed the application's trim-then-min(2) check on some paths and
--    produced an unidentifiable row in the salon's day sheet.
--
--  * salons_slot_positive — slot_min of 0 makes the grid generator loop
--    forever. salons_hours_ordered — closing before opening renders an empty
--    day with nothing on screen to explain why.
--
-- If any of these fails to apply, the database already holds a row that
-- violates it: find it with the matching SELECT before re-running.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_within_day" CHECK ("bookings"."start_min" + "bookings"."duration_min" <= 1440);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_name_present" CHECK (length(btrim("bookings"."client_name")) > 0);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_present" CHECK (length(btrim("bookings"."service")) > 0);--> statement-breakpoint
ALTER TABLE "salons" ADD CONSTRAINT "salons_hours_ordered" CHECK ("salons"."opens_at_min" >= 0 AND "salons"."closes_at_min" <= 1440 AND "salons"."opens_at_min" < "salons"."closes_at_min");--> statement-breakpoint
ALTER TABLE "salons" ADD CONSTRAINT "salons_slot_positive" CHECK ("salons"."slot_min" > 0 AND "salons"."slot_min" <= 480);