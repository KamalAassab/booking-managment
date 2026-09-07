"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { login, type ActionState } from "@/app/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Connexion…" : "Se connecter"}
    </button>
  );
}

export function LoginForm({ initialRole }: { initialRole: "staff" | "owner" }) {
  const [role, setRole] = useState<"staff" | "owner">(initialRole);
  const [state, formAction] = useActionState<ActionState, FormData>(login, {});

  return (
    <form action={formAction} className="panel rounded-2xl p-6 shadow-sm">
      {/* One shared staff account and one owner account (brief §3), so the
          role toggle replaces a username field entirely — one less thing to
          type while a client waits on the phone. */}
      <div
        className="mb-5 grid grid-cols-2 gap-1 rounded-xl p-1"
        style={{ background: "var(--surface)" }}
        role="radiogroup"
        aria-label="Type de compte"
      >
        {(
          [
            ["staff", "Personnel"],
            ["owner", "Propriétaire"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={role === value}
            onClick={() => setRole(value)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              role === value
                ? "bg-brand-600 text-white shadow-sm"
                : "hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <input type="hidden" name="role" value={role} />

      <label className="label" htmlFor="password">
        Mot de passe
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        className="field mb-4"
        placeholder="••••••••"
      />

      {state.error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
