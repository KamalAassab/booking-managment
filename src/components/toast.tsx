"use client";

import { useEffect } from "react";

export type ToastMessage = {
  tone: "success" | "error";
  text: string;
  action?: { label: string; href: string };
};

export function Toast({
  message,
  onDismiss,
}: {
  message: ToastMessage | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    // A toast carrying a WhatsApp link has to survive long enough to click.
    const ms = message.action ? 15000 : 4000;
    const timer = setTimeout(onDismiss, ms);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      <div
        className={`pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
          message.tone === "success"
            ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
            : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        }`}
      >
        <span>{message.text}</span>
        {message.action ? (
          <a
            href={message.action.href}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 underline underline-offset-2"
          >
            {message.action.label}
          </a>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 opacity-60 hover:opacity-100"
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
