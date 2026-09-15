/**
 * The title block of the secondary pages (clients, services, owner): one
 * display-size title, one line of context, actions to the right on wide
 * screens and under the title on a phone. No eyebrow label above it.
 */
export function PageHeader({
  title,
  titleClassName = "",
  description,
  actions,
}: {
  title: React.ReactNode;
  titleClassName?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="min-w-0">
        <h1 className={`t-display text-[26px] leading-8 md:text-[30px] md:leading-9 ${titleClassName}`}>{title}</h1>
        {description ? (
          <p className="t-small mt-1 max-w-[64ch]" style={{ color: "var(--ink-soft)" }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
