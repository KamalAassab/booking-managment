"use client";

/**
 * The last resort: an error thrown by the root layout itself, where
 * app/error.tsx cannot render because the layout it lives inside is what
 * failed. It must supply its own <html> and <body>, and it cannot rely on the
 * stylesheet having loaded, so everything here is inline.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#12161d",
          color: "#e7ebf2",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.7rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#c8a24a",
              fontWeight: 600,
            }}
          >
            L&apos;Atelier Groupe
          </p>
          <h1 style={{ margin: "0.75rem 0 0", fontSize: "1.35rem" }}>
            L&apos;application n&apos;a pas pu démarrer
          </h1>
          <p style={{ margin: "0.5rem 0 0", color: "#9aa4b2", lineHeight: 1.6 }}>
            Il s&apos;agit d&apos;un problème de configuration du serveur, pas
            d&apos;une perte de données. Les réservations sont intactes.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#c8a24a",
                color: "#12161d",
                border: 0,
                borderRadius: "0.5rem",
                padding: "0.55rem 1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Réessayer
            </button>
            <a
              href="/api/health"
              style={{
                color: "#e7ebf2",
                border: "1px solid #2b3341",
                borderRadius: "0.5rem",
                padding: "0.55rem 1rem",
                textDecoration: "none",
              }}
            >
              Diagnostic
            </a>
          </div>
          {error.digest ? (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#6b7482" }}>
              Référence technique : <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
