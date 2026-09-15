import { describe, expect, it } from "vitest";

import { findCatalogEntry, groupCatalog, type ServiceCatalogEntry } from "@/lib/services-catalog";
import { buildConfirmationMessage, buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * The price line of the WhatsApp confirmation. The client reads this number
 * and turns up expecting to pay it, so it must be the price the agent saw —
 * the owner's live price, or what the agent typed — never a stale default.
 */

const base = {
  clientName: "Salma Bennani",
  clientPhone: "+212612345678",
  salonName: "L'Atelier VIP",
  salonSlug: "vip",
  bookingDate: "2026-09-08",
  startMin: 870,
  durationMin: 30,
  service: "Manucure Simple",
};

const liveCatalog: ServiceCatalogEntry[] = [
  { category: "Onglerie", name: "Manucure Simple", durationMin: 30, price: 65 },
  { category: "Onglerie", name: "Pose de Gel", durationMin: 90, price: 210 },
];

describe("confirmation price", () => {
  it("quotes an explicit price exactly", () => {
    expect(buildConfirmationMessage({ ...base, price: 120 })).toContain("120 MAD");
  });

  it("looks the price up in the live catalogue when one is given", () => {
    const message = buildConfirmationMessage({ ...base, catalog: liveCatalog });
    expect(message).toContain("65 MAD");
    expect(message).not.toContain("50 MAD");
  });

  it("matches the catalogue however the service was capitalised or spaced", () => {
    expect(buildConfirmationMessage({ ...base, service: " manucure simple ", catalog: liveCatalog })).toContain("65 MAD");
  });

  it("falls back to the static catalogue without a live one", () => {
    expect(buildConfirmationMessage(base)).toContain("50 MAD");
  });

  it("carries no price when the agent cleared the field or the service is custom", () => {
    expect(buildConfirmationMessage({ ...base, price: "" })).not.toContain("MAD");
    expect(buildConfirmationMessage({ ...base, price: null })).not.toContain("MAD");
    expect(buildConfirmationMessage({ ...base, service: "Coiffure mariée", catalog: liveCatalog })).not.toContain("MAD");
  });

  it("quotes a free service as 0 MAD rather than dropping the line", () => {
    expect(buildConfirmationMessage({ ...base, price: 0 })).toContain("0 MAD");
  });
});

describe("confirmation link robustness", () => {
  it("does not throw on half an emoji pasted into a name or note", () => {
    const broken = "Zoé \uD83D"; // a lone high surrogate
    expect(() => buildWhatsAppLink({ ...base, clientName: broken, notes: "\uDC85 fin" })).not.toThrow();
    const text = new URL(buildWhatsAppLink({ ...base, clientName: broken })).searchParams.get("text");
    expect(text).toContain("Zoé");
  });

  it("keeps complete emoji intact", () => {
    const text = new URL(buildWhatsAppLink({ ...base, notes: "💅 French" })).searchParams.get("text");
    expect(text).toContain("💅 French");
  });
});

describe("catalogue helpers", () => {
  it("finds an entry case- and space-insensitively and returns undefined otherwise", () => {
    expect(findCatalogEntry(liveCatalog, "POSE DE GEL")?.price).toBe(210);
    expect(findCatalogEntry(liveCatalog, "Pose")).toBeUndefined();
  });

  it("groups any catalogue in first-seen category order", () => {
    const grouped = groupCatalog([
      { category: "B", name: "b1", durationMin: 30, price: 1 },
      { category: "A", name: "a1", durationMin: 30, price: 1 },
      { category: "B", name: "b2", durationMin: 30, price: 1 },
    ]);
    expect(grouped.map((g) => [g.category, g.items.map((i) => i.name)])).toEqual([
      ["B", ["b1", "b2"]],
      ["A", ["a1"]],
    ]);
  });
});
