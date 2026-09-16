import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await getSession();
  if (session) redirect(session.role === "owner" ? "/owner" : "/bookings");

  const params = await searchParams;
  const initialRole = params.role === "owner" ? "owner" : "staff";

  return (
    <main className="auth-noir relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden px-4 py-12">
      {/* Ambient luxury warmth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
      >
        <div
          className="h-[500px] w-[500px] rounded-full opacity-40 blur-[100px]"
          style={{
            background: "radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[390px]">
        {/* The logo already reads "L'Atelier Groupe — Beauty Lounge & Spa",
            so the wordmark is not repeated under it, and "Plateforme de
            gestion" went with it: it said the same thing as the title and
            the line below, three times in a row. */}
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-transparent.webp"
            alt="L'Atelier Groupe — Beauty Lounge &amp; Spa"
            className="mx-auto h-16 w-auto max-w-[240px] object-contain"
          />
          <h1 className="t-display mt-5 text-[26px]">Planning</h1>
          <p className="t-small mt-1.5" style={{ color: "var(--ink-soft)" }}>
            Réservations des trois salons d&apos;El Jadida
          </p>
        </div>

        <LoginForm initialRole={initialRole} />

        <p
          className="t-small mt-6 text-center text-[12.5px]"
          style={{ color: "var(--ink-faint)" }}
        >
          Poste partagé — déconnectez-vous en fin de journée sur un ordinateur non dédié.
        </p>
      </div>
    </main>
  );
}
