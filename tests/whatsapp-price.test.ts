import { describe, expect, it } from "vitest";

import { findCatalogEntry, groupCatalog, type ServiceCatalogEntry } from "@/lib/services-catalog";
import { buildConfirmationMessage, buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * The price line of the WhatsApp confirmation. The client reads this number
 * and turns up expecting to pay it, so it must be the price actually stored
 * on the booking — each service's own price, summed — never a lookup that
 * could disagree with what was saved.
 */

const base = {
  clientName: "Salma Bennani",
  clientPhone: "+212612345678",
  salonName: "L'Atelier VIP",
  salonSlug: "vip",
  bookingDate: "2026-09-08",
  startMin: 870,
  services: [{ service: "Manucure Simple", durationMin: 30, price: 65 }],
};

const liveCatalog: ServiceCatalogEntry[] = [
  { category: "Onglerie", name: "Manucure Simple", durationMin: 30, price: 65 },
  { category: "Onglerie", name: "Pose de Gel", durationMin: 90, price: 210 },
];

describe("confirmation price", () => {
  it("quotes the service's own stored price", () => {
    expect(buildConfirmationMessage(base)).toContain("65 MAD");
  });

  it("sums several services into one total, and lists them all", () => {
    const message = buildConfirmationMessage({
      ...base,
      services: [
        { service: "Coupe", durationMin: 30, price: 80 },
        { service: "Coloration", durationMin: 60, price: 250 },
      ],
    });
    expect(message).toContain("330 MAD");
    expect(message).toContain("Coupe + Coloration");
  });

  it("carries no price line when every service is free", () => {
    expect(
      buildConfirmationMessage({
        ...base,
        services: [{ service: "Manucure Simple", durationMin: 30, price: 0 }],
      }),
    ).not.toContain("MAD");
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
