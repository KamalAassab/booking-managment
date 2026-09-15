"use client";

import { useRef, useState, useTransition } from "react";

import {
  createServiceAction,
  deleteServiceAction,
  updateServiceAction,
  type ServiceActionState,
} from "@/app/actions/services";
import { Plus, Close } from "@/components/icons";
import { salonColor, shortName } from "@/lib/salon-display";
import type { Service } from "@/lib/services";
import { MAX_DURATION_MIN, MIN_DURATION_MIN } from "@/lib/validation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type SalonTab = {
  salonId: string;
  salonSlug: string;
  salonName: string;
  items: Service[];
};

type Props = {
  data: SalonTab[];
};

/** Groups a flat list of services into { category → items[] }. */
function groupByCategory(items: Service[]): { category: string; items: Service[] }[] {
  const order: string[] = [];
  const map = new Map<string, Service[]>();
  for (const s of items) {
    if (!map.has(s.category)) {
      map.set(s.category, []);
      order.push(s.category);
    }
    map.get(s.category)!.push(s);
  }
  return order.map((cat) => ({ category: cat, items: map.get(cat)! }));
}

// ---------------------------------------------------------------------------
// Inline editable cell
// ---------------------------------------------------------------------------

function EditableCell({
  serviceId,
  field,
  value,
  type = "text",
  prefix,
  suffix,
  min,
  max,
}: {
  serviceId: string;
  field: "name" | "category" | "durationMin" | "price";
  value: string | number;
  type?: "text" | "number";
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Enter commits and the input then unmounts, which fires blur — so the same
  // edit used to be sent twice, and Escape's unmount sent the very edit it was
  // meant to discard. Once an edit is settled, the trailing blur is ignored.
  const settled = useRef(false);

  function cancel() {
    settled.current = true;
    setError(null);
    setEditing(false);
  }

  function commit() {
    if (settled.current) return;
    settled.current = true;
    if (localValue.trim() === String(value)) {
      setError(null);
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set("id", serviceId);
    fd.set(field, localValue);
    startTransition(async () => {
      const result = await updateServiceAction({}, fd);
      if (result.error) {
        // Stay in the field with the reason, rather than snapping back to the
        // old value as if the edit had been saved.
        setError(result.error);
        settled.current = false;
        return;
      }
      setError(null);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          settled.current = false;
          setLocalValue(String(value));
          setEditing(true);
        }}
        title="Modifier"
        aria-label={`Modifier : ${value}${suffix ?? ""}`}
        className="svc-cell"
        style={{ opacity: pending ? 0.5 : 1 }}
      >
        {prefix && (
          <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>{prefix}</span>
        )}
        <span style={{ color: "var(--ink)" }}>{value}</span>
        {suffix && (
          <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>{suffix}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {prefix && (
          <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>{prefix}</span>
        )}
        <input
          autoFocus
          type={type}
          value={localValue}
          min={min}
          max={max}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            settled.current = false;
            setLocalValue(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="field"
          style={{
            minHeight: 40,
            padding: "6px 10px",
            fontSize: 14,
            width: type === "number" ? 80 : "100%",
            minWidth: type === "text" ? 120 : undefined,
          }}
        />
        {suffix && (
          <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>{suffix}</span>
        )}
      </div>
      {error ? (
        <p role="alert" className="t-small" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete button
// ---------------------------------------------------------------------------

function DeleteButton({ serviceId }: { serviceId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirm) {
    return (
      <div className="flex items-center gap-1">
        {error ? (
          <span role="alert" className="t-small" style={{ color: "var(--danger)" }}>
            {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirm(true);
          }}
          aria-label="Supprimer ce service"
          title="Supprimer ce service"
          className="svc-delete"
        >
          <Close size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="t-small" style={{ color: "var(--danger)" }}>
        Supprimer ?
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("id", serviceId);
          startTransition(async () => {
            const result = await deleteServiceAction({}, fd);
            if (result.error) {
              setError(result.error);
              setConfirm(false);
            }
          });
        }}
        className="btn-danger btn-sm"
      >
        Oui
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        className="btn-quiet btn-sm"
      >
        Non
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add service row form
// ---------------------------------------------------------------------------

function AddServiceSubmit({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary flex-1 sm:flex-none"
    >
      <Plus size={16} />
      {pending ? "Ajout…" : "Ajouter le service"}
    </button>
  );
}

function AddServiceForm({
  salonId,
  categories,
}: {
  salonId: string;
  categories: string[];
}) {
  const [open, setOpen] = useState(false);
  // Remounts the form body on every opening, so an error from a previous
  // attempt is not still showing on a fresh one.
  const [openings, setOpenings] = useState(0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpenings((n) => n + 1);
          setOpen(true);
        }}
        className="btn-secondary w-full sm:w-auto"
      >
        <Plus size={16} />
        Nouveau service
      </button>
    );
  }

  return (
    <AddServiceFormBody
      key={openings}
      salonId={salonId}
      categories={categories}
      onClose={() => setOpen(false)}
    />
  );
}

function AddServiceFormBody({
  salonId,
  categories,
  onClose,
}: {
  salonId: string;
  categories: string[];
  onClose: () => void;
}) {
  // The form closes only once the service is actually saved. It used to close
  // as soon as it was submitted — before the server answered — so a refused
  // service vanished with its error. It is submitted through onSubmit rather
  // than `<form action>`: React resets an action form's fields when the
  // action finishes, which would wipe what the owner typed along with the
  // reason it was refused.
  const [state, setState] = useState<ServiceActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createServiceAction({}, formData);
          if (result.success) onClose();
          else setState(result);
        });
      }}
      className="card p-4 md:p-5"
    >
      <p className="t-heading mb-3">Nouveau service</p>
      <input type="hidden" name="salonId" value={salonId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`cat-${salonId}`}>
            Catégorie
          </label>
          <input
            id={`cat-${salonId}`}
            name="category"
            list={`cats-${salonId}`}
            required
            placeholder={categories[0] ?? "Catégorie"}
            className="field"
          />
          <datalist id={`cats-${salonId}`}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label" htmlFor={`name-${salonId}`}>
            Nom du service
          </label>
          <input
            id={`name-${salonId}`}
            name="name"
            required
            placeholder="Soin Express"
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor={`dur-${salonId}`}>
            Durée (min)
          </label>
          <input
            id={`dur-${salonId}`}
            name="durationMin"
            type="number"
            min={MIN_DURATION_MIN}
            max={MAX_DURATION_MIN}
            defaultValue={30}
            required
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor={`price-${salonId}`}>
            Prix (MAD)
          </label>
          <input
            id={`price-${salonId}`}
            name="price"
            type="number"
            min={0}
            max={99999}
            defaultValue={0}
            required
            className="field"
          />
        </div>
      </div>

      {state.error && (
        <p
          role="alert"
          className="t-small mt-3 rounded-[10px] px-3 py-2"
          style={{ background: "var(--danger-tint)", color: "var(--danger)" }}
        >
          {state.error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <AddServiceSubmit pending={pending} />
        <button
          type="button"
          onClick={onClose}
          className="btn-quiet"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Category section
// ---------------------------------------------------------------------------

function CategorySection({
  category,
  items,
}: {
  category: string;
  items: Service[];
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline gap-2 px-1 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
        {category}
        <span className="font-medium" style={{ color: "var(--ink-faint)" }} data-nums>
          {items.length}
        </span>
      </h3>

      <div className="card overflow-hidden p-0">
        <div
          className="svc-row svc-head hidden md:grid"
          style={{ borderColor: "var(--line)", background: "var(--surface-hover)" }}
          aria-hidden
        >
          <span className="[grid-area:name]">Service</span>
          <span className="[grid-area:cat]">Catégorie</span>
          <span className="[grid-area:dur]">Durée</span>
          <span className="[grid-area:price]">Prix</span>
        </div>

        {items.map((service) => (
          <div key={service.id} className="svc-row">
            <div className="min-w-0 font-semibold [grid-area:name]">
              <EditableCell serviceId={service.id} field="name" value={service.name} type="text" />
            </div>
            <div className="min-w-0 text-[13px] [grid-area:cat]" style={{ color: "var(--ink-soft)" }}>
              <EditableCell serviceId={service.id} field="category" value={service.category} type="text" />
            </div>
            <div className="[grid-area:dur]" data-nums>
              <EditableCell
                serviceId={service.id}
                field="durationMin"
                value={service.durationMin}
                type="number"
                suffix=" min"
                min={MIN_DURATION_MIN}
                max={MAX_DURATION_MIN}
              />
            </div>
            <div className="[grid-area:price]" data-nums>
              <EditableCell
                serviceId={service.id}
                field="price"
                value={service.price}
                type="number"
                suffix=" MAD"
                min={0}
                max={99999}
              />
            </div>
            <div className="flex justify-end [grid-area:del]">
              <DeleteButton serviceId={service.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Salon tab panel
// ---------------------------------------------------------------------------

function SalonPanel({ tab }: { tab: SalonTab }) {
  const groups = groupByCategory(tab.items);
  const categories = groups.map((g) => g.category);

  return (
    <div className="flex flex-col gap-5">
      <p className="t-small" style={{ color: "var(--ink-soft)" }} data-nums>
        {tab.items.length} service{tab.items.length !== 1 ? "s" : ""} dans {groups.length} catégorie
        {groups.length !== 1 ? "s" : ""}
      </p>

      {groups.length === 0 ? (
        <p className="t-small" style={{ color: "var(--ink-faint)" }}>
          Aucun service pour ce salon.
        </p>
      ) : (
        groups.map((g) => (
          <CategorySection key={g.category} category={g.category} items={g.items} />
        ))
      )}

      <AddServiceForm salonId={tab.salonId} categories={categories} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

export function ServicesTabs({ data }: Props) {
  const defaultTab = data[0]?.salonId ?? "";

  return (
    <Tabs defaultValue={defaultTab} className="flex w-full flex-col gap-4">
      <TabsList aria-label="Salon" className="w-full sm:w-auto sm:self-start">
        {data.map((tab) => (
          <TabsTrigger
            key={tab.salonId}
            value={tab.salonId}
            color={salonColor(tab.salonSlug)}
            className="flex-1 justify-center sm:flex-none"
          >
            {shortName(tab.salonName)}
          </TabsTrigger>
        ))}
      </TabsList>

      {data.map((tab) => (
        <TabsContent key={tab.salonId} value={tab.salonId}>
          <SalonPanel tab={tab} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
