/**
 * What the staff see instead of a blank "A server error occurred" page when
 * the deployment itself is not ready.
 *
 * This is not decoration. The screen this replaced was Next.js's default
 * error page: a warning triangle, "A server error occurred", and an
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
    <main className="flex min-h-dvh flex-1 items-center justify-center p-4">
      <div className="card w-full max-w-[520px] p-6 md:p-8">
        <p className="t-micro" style={{ color: "var(--brass)" }}>
          L&apos;Atelier Groupe
        </p>
        <h1 className="t-title mt-3">{title}</h1>
        <p className="mt-2" style={{ color: "var(--ink-soft)" }}>
          {message}
        </p>

        {steps?.length ? (
          <ol className="mt-5 flex flex-col gap-2">
            {steps.map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span
                  className="t-small mt-1.5 shrink-0 font-semibold"
                  style={{ color: "var(--ink-faint)" }}
                  data-nums
                >
                  {i + 1}
                </span>
                <code
                  className="t-small min-w-0 flex-1 break-all rounded-[8px] px-2.5 py-2 font-mono"
                  style={{ background: "var(--surface-sunk)" }}
                >
                  {step}
                </code>
              </li>
            ))}
          </ol>
        ) : null}

        {detail ? (
          <pre
            className="t-small mt-5 overflow-x-auto rounded-[10px] p-3 font-mono"
            style={{ background: "var(--surface-sunk)", color: "var(--ink-soft)" }}
          >
            {detail}
          </pre>
        ) : null}

        <p className="t-small mt-6" style={{ color: "var(--ink-faint)" }}>
          <a href="/api/health" className="underline underline-offset-2">
            /api/health
          </a>{" "}
          liste chaque vérification et ce qui échoue.
        </p>
      </div>
    </main>
  );
}
