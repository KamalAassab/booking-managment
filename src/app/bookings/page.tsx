import { redirect } from "next/navigation";

import { BookingsBoard } from "@/components/bookings-board";
import { SetupNotice } from "@/components/setup-notice";
import { requireSession } from "@/lib/auth";
import { getSalonBySlug, listBookings, listSalons } from "@/lib/bookings";
import { setupNoticeFor } from "@/lib/page-errors";
import { isValidDateString, todayInSalonTz } from "@/lib/time";
import { toBookingDTO, toSalonDTO } from "@/lib/types";
import type { Salon } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: PageProps<"/bookings">) {
  const session = await requireSession();
  const params = await searchParams;

  let salons: Salon[];
  try {
    salons = await listSalons();
  } catch (error) {
    // Before this, an unmigrated database threw SQLSTATE 42P01 straight out
    // of the page and Next.js answered "A server error occurred" — the exact
    // screen this audit started from. The `salons.length === 0` branch below
    // was unreachable, because the query never returned to be counted.
    const notice = setupNoticeFor(error);
    if (notice) return notice;
    throw error;
  }

  if (salons.length === 0) {
    return (
      <SetupNotice
        title="Aucun salon configuré"
        message="Les tables existent mais elles sont vides. Cette commande crée les trois salons et les deux comptes."
        steps={["npm run db:seed"]}
      />
    );
  }

  const requestedSalon = typeof params.salon === "string" ? params.salon : "";
  const salon =
    (requestedSalon ? await getSalonBySlug(requestedSalon) : null) ?? salons[0];

  const requestedDate = typeof params.date === "string" ? params.date : "";
  const date =
    requestedDate && isValidDateString(requestedDate)
      ? requestedDate
      : todayInSalonTz();

  // Normalise the URL so the salon/date are always explicit — this is what
  // makes the live updates, refresh, and "open on the second monitor" all
  // land on the same view. redirect() throws, so it stays outside any catch.
  if (salon.slug !== requestedSalon || date !== requestedDate) {
    redirect(`/bookings?salon=${salon.slug}&date=${date}`);
  }

  const bookings = await listBookings(salon.id, date);

  return (
    <BookingsBoard
      key={`${salon.slug}:${date}`}
      salons={salons.map(toSalonDTO)}
      salon={toSalonDTO(salon)}
      date={date}
      initialBookings={bookings.map(toBookingDTO)}
      role={session.role}
    />
  );
}
