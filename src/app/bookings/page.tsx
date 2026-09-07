import { redirect } from "next/navigation";

import { BookingsBoard } from "@/components/bookings-board";
import { requireSession } from "@/lib/auth";
import { getSalonBySlug, listBookings, listSalons } from "@/lib/bookings";
import { isValidDateString, todayInSalonTz } from "@/lib/time";
import { toBookingDTO, toSalonDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: PageProps<"/bookings">) {
  const session = await requireSession();
  const params = await searchParams;

  const salons = await listSalons();
  if (salons.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="panel max-w-md rounded-2xl p-8">
          <h1 className="text-lg font-semibold">Aucun salon configuré</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Lancez <code className="font-mono">npm run db:seed</code> pour créer
            les trois salons et les comptes.
          </p>
        </div>
      </main>
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
  // makes the live stream, refresh, and "open on the second monitor" all
  // land on the same view.
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
