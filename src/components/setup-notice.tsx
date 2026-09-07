/**
 * What the staff see instead of a blank "A server error occurred" page when
 * the deployment itself is not ready.
 *
 * This is not decoration. The screenshot that started this audit was Next.js's
 * default error page: a warning triangle, "A server error occurred", and an
 * eight-digit digest. It gives the person in the salon nothing to do and the
 * person who has to fix it nothing to go on.
 */

type Props = {
  title: string;
  message: string;
  /** Shell commands, shown in order. */
  steps?: string[];
  /** Rendered as a monospace block — an error message, never a secret. */
  detail?: string | null;
};

export function SetupNotice({ title, message, steps, detail }: Props) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="panel w-full max-w-xl rounded-2xl p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
          L&apos;Atelier Groupe
        </p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {message}
        </p>

        {steps?.length ? (
          <ol className="mt-5 space-y-2">
            {steps.map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-sm">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{ background: "var(--surface)" }}
                >
                  {i + 1}
                </span>
                <code
                  className="min-w-0 flex-1 break-all rounded-md px-2 py-1 font-mono text-xs"
                  style={{ background: "var(--surface)" }}
                >
                  {step}
                </code>
              </li>
            ))}
          </ol>
        ) : null}

        {detail ? (
          <pre
            className="mt-5 overflow-x-auto rounded-lg p-3 font-mono text-xs"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}
          >
            {detail}
          </pre>
        ) : null}

        <p className="mt-6 text-xs" style={{ color: "var(--text-muted)" }}>
          <a href="/api/health" className="underline">
            /api/health
          </a>{" "}
          lists every check and what is failing.
        </p>
      </div>
    </main>
  );
}
