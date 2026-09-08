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
    <form action={formAction} className="card p-5 md:p-6">
      {/* One shared staff account and one owner account (brief §3), so the
          role toggle replaces a username field entirely — one less thing to
          type while a client waits on the phone. */}
      <div
        className="mb-5 grid grid-cols-2 gap-0.5 rounded-full p-0.5"
        style={{ background: "var(--surface-sunk)" }}
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
            className="min-h-[40px] rounded-full px-3 text-[14px] transition-colors duration-[120ms]"
            style={{
              background: role === value ? "var(--surface)" : "transparent",
              boxShadow: role === value ? "var(--shadow-card)" : "none",
              color: role === value ? "var(--ink)" : "var(--ink-soft)",
              fontWeight: role === value ? 600 : 500,
            }}
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
        className="field"
        placeholder="••••••••"
        aria-invalid={state.error ? true : undefined}
      />

      {state.error ? (
        <p
          role="alert"
          className="t-small mt-3 rounded-[10px] px-3 py-2.5"
          style={{ background: "var(--danger-tint)", color: "var(--danger)" }}
        >
          {state.error}
        </p>
      ) : null}

      <div className="mt-4">
        <SubmitButton />
      </div>
    </form>
  );
}
