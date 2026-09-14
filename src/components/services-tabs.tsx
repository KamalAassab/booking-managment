"use client";

import {
  useActionState,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";

import {
  createServiceAction,
  deleteServiceAction,
  updateServiceAction,
  type ServiceActionState,
} from "@/app/actions/services";
import { Plus, Close, Check } from "@/components/icons";
import { salonColor, shortName } from "@/lib/salon-display";
import type { Service } from "@/lib/services";
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
  const [pending, startTransition] = useTransition();

  function commit() {
    if (localValue === String(value)) {
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set("id", serviceId);
    fd.set(field, localValue);
    startTransition(async () => {
      await updateServiceAction({}, fd);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setLocalValue(String(value));
          setEditing(true);
        }}
        title="Cliquer pour modifier"
        className="group/cell flex items-center gap-1 rounded-[6px] px-2 py-1 text-left transition-colors duration-[120ms] hover:bg-[color:var(--accent-tint)]"
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
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setLocalValue(String(value));
            setEditing(false);
          }
        }}
        className="field"
        style={{
          minHeight: 32,
          padding: "4px 8px",
          fontSize: 14,
          width: type === "number" ? 80 : "100%",
          minWidth: type === "text" ? 120 : undefined,
        }}
      />
      {suffix && (
        <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>{suffix}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete button
// ---------------------------------------------------------------------------

function DeleteButton({ serviceId }: { serviceId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [, startTransition] = useTransition();

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        aria-label="Supprimer"
        className="flex h-7 w-7 items-center justify-center rounded-[6px] opacity-0 transition-opacity duration-[120ms] group-hover/row:opacity-100 hover:bg-[color:var(--danger-tint)]"
        style={{ color: "var(--danger)" }}
      >
        <Close size={14} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="t-small" style={{ color: "var(--danger)" }}>
        Supprimer ?
      </span>
      <button
        type="button"
        onClick={() => {
          const fd = new FormData();
          fd.set("id", serviceId);
          startTransition(async () => {
            await deleteServiceAction({}, fd);
          });
        }}
        className="btn btn-danger btn-sm"
        style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
      >
        Oui
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        className="btn btn-quiet btn-sm"
        style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
      >
        Non
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add service row form
// ---------------------------------------------------------------------------

function AddServiceSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary btn-sm flex items-center gap-1.5"
      style={{ minHeight: 36 }}
    >
      <Plus size={14} />
      {pending ? "Ajout…" : "Ajouter"}
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
  const [state, formAction] = useActionState<ServiceActionState, FormData>(
    createServiceAction,
    {},
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-quiet btn-sm flex items-center gap-1.5 mt-2"
      >
        <Plus size={14} />
        Nouveau service
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        await formAction(fd);
        setOpen(false);
      }}
      className="mt-3 card p-4 anim-panel"
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
            placeholder="Ex: Soin Express"
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
            min={1}
            max={480}
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
        <AddServiceSubmit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn-quiet btn-sm"
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
    <section className="mb-6">
      <h3
        className="t-micro mb-2 px-2"
        style={{ color: "var(--ink-soft)" }}
      >
        {category}
      </h3>

      <div className="card overflow-hidden">
        {/* Table header */}
        <div
          className="hidden grid-cols-[1fr_140px_100px_80px_44px] gap-2 border-b px-4 py-2 sm:grid"
          style={{ borderColor: "var(--line)", background: "var(--surface-sunk)" }}
        >
          <span className="label mb-0">Service</span>
          <span className="label mb-0">Catégorie</span>
          <span className="label mb-0">Durée</span>
          <span className="label mb-0">Prix</span>
          <span />
        </div>

        {items.map((service, i) => (
          <div
            key={service.id}
            className="group/row flex flex-col gap-2 border-b px-4 py-3 sm:grid sm:grid-cols-[1fr_140px_100px_80px_44px] sm:items-center sm:gap-2"
            style={{
              borderColor: i === items.length - 1 ? "transparent" : "var(--line)",
            }}
          >
            {/* Name */}
            <EditableCell
              serviceId={service.id}
              field="name"
              value={service.name}
              type="text"
            />
            {/* Category (editable) */}
            <EditableCell
              serviceId={service.id}
              field="category"
              value={service.category}
              type="text"
            />
            {/* Duration */}
            <EditableCell
              serviceId={service.id}
              field="durationMin"
              value={service.durationMin}
              type="number"
              suffix=" min"
              min={1}
              max={480}
            />
            {/* Price */}
            <EditableCell
              serviceId={service.id}
              field="price"
              value={service.price}
              type="number"
              suffix=" MAD"
              min={0}
              max={99999}
            />
            {/* Delete */}
            <div className="flex justify-end">
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
    <div>
      <div
        className="mb-4 flex items-center gap-2 rounded-[12px] px-4 py-3"
        style={{ background: "var(--surface-sunk)" }}
      >
        <span
          className="block h-2 w-2 shrink-0 rounded-full"
          style={{ background: salonColor(tab.salonSlug) }}
          aria-hidden
        />
        <p className="t-small" style={{ color: "var(--ink-soft)" }}>
          <strong style={{ color: "var(--ink)" }}>{tab.items.length}</strong>{" "}
          service{tab.items.length !== 1 ? "s" : ""} — cliquer une cellule pour modifier
        </p>
      </div>

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
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList aria-label="Salon" className="mb-6">
        {data.map((tab) => (
          <TabsTrigger
            key={tab.salonId}
            value={tab.salonId}
            color={salonColor(tab.salonSlug)}
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
