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
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 text-center">
          <p className="t-micro" style={{ color: "var(--brass)" }}>
            L&apos;Atelier Groupe
          </p>
          <h1 className="t-display mt-2">Planning</h1>
          <p className="t-small mt-1.5" style={{ color: "var(--ink-faint)" }}>
            Réservations des trois salons
          </p>
        </div>

        <LoginForm initialRole={initialRole} />

        <p
          className="t-small mt-6 text-center"
          style={{ color: "var(--ink-faint)" }}
        >
          Poste partagé — déconnectez-vous en fin de journée sur un ordinateur
          non dédié.
        </p>
      </div>
    </main>
  );
}
