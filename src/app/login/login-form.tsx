"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { login, type ActionState } from "@/app/actions/auth";
import { OwnerAvatarIcon, Phone } from "@/components/icons";

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
  const [showPassword, setShowPassword] = useState(false);

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
            ["staff", "Agent", Phone],
            ["owner", "Propriétaire", OwnerAvatarIcon],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={role === value}
            onClick={() => setRole(value)}
            className="flex min-h-[40px] items-center justify-center gap-2 rounded-full px-3 text-[13.5px] transition-colors duration-[120ms]"
            style={{
              background: role === value ? "var(--surface)" : "transparent",
              boxShadow: role === value ? "var(--shadow-card)" : "none",
              color: role === value ? "var(--ink)" : "var(--ink-soft)",
              fontWeight: role === value ? 600 : 500,
            }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <input type="hidden" name="role" value={role} />

      <label className="label" htmlFor="password">
        Mot de passe
      </label>
      <div className="relative">
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          autoFocus
          required
          className="field pr-11"
          placeholder="••••••••"
          aria-invalid={state.error ? true : undefined}
        />
        <button
          type="button"
          aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          onClick={() => setShowPassword((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors duration-[120ms] hover:bg-[color:var(--surface-sunk)]"
          style={{ color: "var(--ink-faint)" }}
          tabIndex={-1}
        >
          {showPassword ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
              <path d="M3 3l18 18" />
            </svg>
          ) : (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

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
