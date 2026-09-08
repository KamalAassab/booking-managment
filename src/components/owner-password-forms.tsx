"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  changeOwnerPassword,
  changeStaffPassword,
  type ActionState,
} from "@/app/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Enregistrement…" : label}
    </button>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="t-small mt-3 rounded-[10px] px-3 py-2.5"
        style={{ background: "var(--danger-tint)", color: "var(--danger)" }}
      >
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="t-small mt-3 rounded-[10px] px-3 py-2.5"
        style={{ background: "var(--brass-tint)", color: "var(--ink)" }}
      >
        {state.success}
      </p>
    );
  }
  return null;
}

export function OwnerPasswordForms() {
  const [staffState, staffAction] = useActionState<ActionState, FormData>(
    changeStaffPassword,
    {},
  );
  const [ownerState, ownerAction] = useActionState<ActionState, FormData>(
    changeOwnerPassword,
    {},
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={staffAction} className="card p-5">
        <h3 className="mb-4 text-sm font-semibold">
          Mot de passe du personnel (partagé)
        </h3>

        <label className="label" htmlFor="staff-password">
          Nouveau mot de passe
        </label>
        <input
          id="staff-password"
          name="password"
          type="password"
          className="field mb-3"
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          required
        />

        <label className="label" htmlFor="staff-confirm">
          Confirmer
        </label>
        <input
          id="staff-confirm"
          name="confirm"
          type="password"
          className="field mb-4"
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          required
        />

        <Submit label="Changer le mot de passe" />
        <Feedback state={staffState} />
      </form>

      <form action={ownerAction} className="card p-5">
        <h3 className="mb-4 text-sm font-semibold">Votre mot de passe</h3>

        <label className="label" htmlFor="owner-current">
          Mot de passe actuel
        </label>
        <input
          id="owner-current"
          name="current"
          type="password"
          className="field mb-3"
          autoComplete="current-password"
          required
        />

        <label className="label" htmlFor="owner-password">
          Nouveau mot de passe
        </label>
        <input
          id="owner-password"
          name="password"
          type="password"
          className="field mb-3"
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          required
        />

        <label className="label" htmlFor="owner-confirm">
          Confirmer
        </label>
        <input
          id="owner-confirm"
          name="confirm"
          type="password"
          className="field mb-4"
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          required
        />

        <Submit label="Changer mon mot de passe" />
        <Feedback state={ownerState} />
      </form>
    </div>
  );
}
