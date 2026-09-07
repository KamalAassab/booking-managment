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
        className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
      >
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
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
      <form action={staffAction} className="panel rounded-xl p-5">
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

      <form action={ownerAction} className="panel rounded-xl p-5">
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
