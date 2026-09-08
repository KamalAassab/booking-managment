"use client";

import { useEffect } from "react";

export type ToastMessage = {
  tone: "success" | "error";
  text: string;
  /** At most one. A toast with two decisions in it is a dialog. */
  action?: { label: string; href: string };
};

type Props = {
  message: ToastMessage | null;
  onDismiss: () => void;
};

const DISMISS_MS = 6000;

export function Toast({ message, onDismiss }: Props) {
  // A toast carrying the WhatsApp link is the only record of a step that has
  // not happened yet, so it waits for the agent rather than timing out.
  const sticky = Boolean(message?.action);

  useEffect(() => {
    if (!message || sticky) return;
    const timer = setTimeout(onDismiss, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, sticky, onDismiss]);

  if (!message) return null;

  const isError = message.tone === "error";

  return (
    <div
      role="status"
      aria-live="polite"
      className="anim-panel fixed inset-x-4 bottom-24 z-50 mx-auto max-w-[420px] md:inset-x-auto md:bottom-6 md:right-6 md:mx-0 lg:bottom-24"
    >
      <div
        className="flex items-center gap-3 rounded-[12px] px-4 py-3"
        style={{
          background: "var(--surface)",
          boxShadow: "var(--shadow-pop)",
          border: "1px solid var(--line)",
        }}
      >
        <p
          className="t-small min-w-0 flex-1"
          style={{ color: isError ? "var(--danger)" : "var(--ink)" }}
        >
          {message.text}
        </p>

        {message.action ? (
          <a
            href={message.action.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onDismiss}
            className="t-small shrink-0 font-semibold underline underline-offset-2"
            style={{ color: "var(--brass)" }}
          >
            {message.action.label}
          </a>
        ) : null}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer"
          className="t-small shrink-0"
          style={{ color: "var(--ink-faint)" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
