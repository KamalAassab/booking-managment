"use client";

/**
 * Catches anything a page throws that its own code did not anticipate.
 *
 * Without this file Next.js renders its built-in "A server error occurred"
 * screen, which tells the salon nothing and gives whoever maintains this
 * nothing but a digest to correlate against platform logs they may not have.
 * The digest is still shown — it is the only thing that ties this render to a
 * log line — but next to an explanation and a link to the diagnostics.
 */

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("unhandled render error", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center p-4">
      <div className="card w-full max-w-[520px] p-6 md:p-8">
        <h1 className="t-title">
          Le planning n&apos;a pas pu s&apos;afficher
        </h1>
        <p className="mt-2" style={{ color: "var(--ink-soft)" }}>
          Réessayez. Si le problème persiste, prévenez la personne qui gère le
          site — les réservations déjà enregistrées ne sont pas perdues.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={reset} className="btn-primary">
            Réessayer
          </button>
          <a href="/bookings" className="btn-quiet">
            Retour au planning
          </a>
        </div>

        {error.digest ? (
          <p className="t-small mt-6" style={{ color: "var(--ink-faint)" }}>
            Référence technique : <code className="font-mono">{error.digest}</code>
            {" · "}
            <a href="/api/health" className="underline">
              diagnostic
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
