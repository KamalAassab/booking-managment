import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const session = await getSession();
  if (session) redirect(session.role === "owner" ? "/owner" : "/bookings");

  const params = await searchParams;
  const initialRole = params.role === "owner" ? "owner" : "staff";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
            L&apos;Atelier Groupe
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Planning
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Gestion des réservations des trois salons
          </p>
        </div>

        <LoginForm initialRole={initialRole} />

        <p
          className="mt-8 text-center text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Poste partagé — pensez à vous déconnecter en fin de journée sur un
          ordinateur non dédié.
        </p>
      </div>
    </main>
  );
}
