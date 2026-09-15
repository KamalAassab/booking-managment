/**
 * Real service catalogue, one per salon — sourced from latelier-groupe's own
 * site data (src/data/services.ts in the marketing-site repo), not invented.
 * Each salon there offers a different subset of the group's services:
 *
 *  - VIP    — the full "femme" catalogue (every category).
 *  - Gold   — "femme", but only Soins Cheveux / Soin Protéine /
 *             Coloration & techniques / Onglerie (see GoldContent.tsx's own
 *             category filter — Gold does not do Hammam, Visage, Regard or
 *             Épilation).
 *  - Barber — the full "homme" catalogue.
 *
 * `durationMin` and `price` pre-fill the booking sheet; staff can still
 * change both after selection.
 */

export type ServiceCatalogEntry = {
  category: string;
  name: string;
  durationMin: number;
  /** Standard price in MAD — auto-fills the booking form, editable by staff. */
  price: number;
};

const SOINS_CHEVEUX: ServiceCatalogEntry[] = [
  { category: "Soins Cheveux", name: "Soin Express Brillance", durationMin: 20, price: 150 },
  { category: "Soins Cheveux", name: "Soin Hydratation Intense", durationMin: 30, price: 250 },
  { category: "Soins Cheveux", name: "Soin Nutrition & Douceur", durationMin: 40, price: 300 },
  { category: "Soins Cheveux", name: "Soin Réparateur Kératine", durationMin: 45, price: 450 },
  { category: "Soins Cheveux", name: "Soin Anti-Casse", durationMin: 35, price: 350 },
  { category: "Soins Cheveux", name: "Soin Anti-Frisottis", durationMin: 45, price: 450 },
  { category: "Soins Cheveux", name: "Soin Cheveux Colorés", durationMin: 30, price: 300 },
];

const SOIN_PROTEINE: ServiceCatalogEntry[] = [
  { category: "Soin Protéine", name: "Lissage Kératine", durationMin: 120, price: 500 },
  { category: "Soin Protéine", name: "Protéine Botox", durationMin: 90, price: 500 },
  { category: "Soin Protéine", name: "Protéine Basic", durationMin: 120, price: 700 },
  { category: "Soin Protéine", name: "Protéine Moyen Gamme", durationMin: 150, price: 900 },
  { category: "Soin Protéine", name: "Protéine Multivitamine Luxe", durationMin: 180, price: 1500 },
];

const COLORATION: ServiceCatalogEntry[] = [
  { category: "Coloration & techniques", name: "Coloration Basic", durationMin: 60, price: 250 },
  { category: "Coloration & techniques", name: "Coloration Sans Ammoniaque", durationMin: 60, price: 400 },
  { category: "Coloration & techniques", name: "Mèches Classiques", durationMin: 90, price: 450 },
  { category: "Coloration & techniques", name: "Balayage Lumière", durationMin: 120, price: 600 },
  { category: "Coloration & techniques", name: "Ombré Hair", durationMin: 150, price: 800 },
  { category: "Coloration & techniques", name: "Coupe + Brushing", durationMin: 45, price: 100 },
  { category: "Coloration & techniques", name: "Brushing Signature", durationMin: 30, price: 40 },
  { category: "Coloration & techniques", name: "Shampoing", durationMin: 10, price: 15 },
  { category: "Coloration & techniques", name: "Shampoing Spécifique", durationMin: 10, price: 25 },
];

const ONGLERIE: ServiceCatalogEntry[] = [
  { category: "Onglerie", name: "Manucure Simple", durationMin: 30, price: 50 },
  { category: "Onglerie", name: "Manucure SPA", durationMin: 45, price: 80 },
  { category: "Onglerie", name: "Manucure de Luxe VIP", durationMin: 50, price: 130 },
  { category: "Onglerie", name: "Bain de Paraffine", durationMin: 20, price: 50 },
  { category: "Onglerie", name: "Pédicure Normale", durationMin: 45, price: 100 },
  { category: "Onglerie", name: "Pédicure SPA", durationMin: 60, price: 130 },
  { category: "Onglerie", name: "Pédicure Médicale VIP + Paraffine", durationMin: 75, price: 250 },
  { category: "Onglerie", name: "Pose Semi-Permanent", durationMin: 40, price: 120 },
  { category: "Onglerie", name: "Semi-Permanent + Manucure Sèche", durationMin: 60, price: 150 },
  { category: "Onglerie", name: "Pose BIAB (Builder In A Bottle)", durationMin: 60, price: 220 },
  { category: "Onglerie", name: "BIAB + Manucure Sèche", durationMin: 75, price: 250 },
  { category: "Onglerie", name: "Pose de Gel", durationMin: 90, price: 200 },
  { category: "Onglerie", name: "Gel + Couleur Permanente", durationMin: 120, price: 300 },
  { category: "Onglerie", name: "Faux Ongles Express", durationMin: 30, price: 50 },
  { category: "Onglerie", name: "Capsules Gel", durationMin: 45, price: 90 },
  { category: "Onglerie", name: "Nail Art ou French", durationMin: 30, price: 50 },
];

const HAMMAM_SPA: ServiceCatalogEntry[] = [
  { category: "Hammam & Spa", name: "Hammam L'Atelier", durationMin: 45, price: 150 },
  { category: "Hammam & Spa", name: "Hammam Royale", durationMin: 75, price: 250 },
  { category: "Hammam & Spa", name: "Hammam VIP", durationMin: 90, price: 300 },
  { category: "Hammam & Spa", name: "Massage Relaxant 45min", durationMin: 45, price: 250 },
  { category: "Hammam & Spa", name: "Massage Relaxant 60min", durationMin: 60, price: 300 },
  { category: "Hammam & Spa", name: "Massage Sportif 45min", durationMin: 45, price: 350 },
  { category: "Hammam & Spa", name: "Massage Sportif 60min", durationMin: 60, price: 400 },
  { category: "Hammam & Spa", name: "Massage Médical 60min", durationMin: 60, price: 400 },
  { category: "Hammam & Spa", name: "Hijama Sec 30min", durationMin: 30, price: 150 },
  { category: "Hammam & Spa", name: "Hijama Sec 60min", durationMin: 60, price: 300 },
];

const SOINS_VISAGE: ServiceCatalogEntry[] = [
  { category: "Soins Visage", name: "Soin Basic Manuel", durationMin: 40, price: 150 },
  { category: "Soins Visage", name: "Soin de Visage Purifiant", durationMin: 60, price: 400 },
  { category: "Soins Visage", name: "Soin de Visage Traitement", durationMin: 75, price: 600 },
  { category: "Soins Visage", name: "Soin de Visage Multivitamine", durationMin: 90, price: 800 },
  { category: "Soins Visage", name: "Soin de Visage Luxe", durationMin: 90, price: 1000 },
];

const REGARD: ServiceCatalogEntry[] = [
  { category: "Regard", name: "Cils par cils en soie", durationMin: 90, price: 400 },
  { category: "Regard", name: "Cils 7D (Volume Russe)", durationMin: 120, price: 600 },
  { category: "Regard", name: "Remplissage Extensions", durationMin: 60, price: 200 },
  { category: "Regard", name: "Dépose Extensions", durationMin: 30, price: 100 },
  { category: "Regard", name: "Browlift", durationMin: 45, price: 250 },
  { category: "Regard", name: "Browlift + Teinture", durationMin: 60, price: 300 },
  { category: "Regard", name: "Lash Lift (Rehaussement)", durationMin: 50, price: 300 },
  { category: "Regard", name: "Lash Lift + Teinture", durationMin: 60, price: 300 },
];

const EPILATION: ServiceCatalogEntry[] = [
  { category: "Épilation", name: "Épilation Sourcils", durationMin: 15, price: 20 },
  { category: "Épilation", name: "Coloration Sourcils / Cils", durationMin: 15, price: 30 },
  { category: "Épilation", name: "Épilation Duvet (Lèvres)", durationMin: 10, price: 15 },
  { category: "Épilation", name: "Épilation Menton", durationMin: 10, price: 15 },
  { category: "Épilation", name: "Épilation Narines / Oreilles", durationMin: 10, price: 20 },
  { category: "Épilation", name: "Épilation Visage au fil", durationMin: 30, price: 60 },
  { category: "Épilation", name: "Épilation Visage à la cire", durationMin: 25, price: 50 },
  { category: "Épilation", name: "Épilation Bras complets", durationMin: 25, price: 60 },
  { category: "Épilation", name: "Épilation Demi-bras", durationMin: 15, price: 40 },
  { category: "Épilation", name: "Épilation Aisselles", durationMin: 10, price: 30 },
  { category: "Épilation", name: "Épilation Ventre", durationMin: 15, price: 40 },
  { category: "Épilation", name: "Épilation Dos", durationMin: 20, price: 50 },
  { category: "Épilation", name: "Épilation Jambes complètes", durationMin: 30, price: 100 },
  { category: "Épilation", name: "Épilation Demi-jambes", durationMin: 15, price: 50 },
  { category: "Épilation", name: "Épilation Maillot Cire (Wax)", durationMin: 20, price: 100 },
  { category: "Épilation", name: "Épilation Complète", durationMin: 60, price: 300 },
];

const COIFFURE_BARBE: ServiceCatalogEntry[] = [
  { category: "Coiffure & Barbe", name: "Coupe Stylisée + Taille de Barbe", durationMin: 45, price: 70 },
  { category: "Coiffure & Barbe", name: "Barbe Traditionnelle & Vapeur", durationMin: 25, price: 30 },
  { category: "Coiffure & Barbe", name: "Coupe Simple", durationMin: 25, price: 40 },
  { category: "Coiffure & Barbe", name: "Coupe Enfant (-12 ans)", durationMin: 20, price: 30 },
  { category: "Coiffure & Barbe", name: "Brushing Homme", durationMin: 15, price: 20 },
];

const SERVICES_SPECIAUX: ServiceCatalogEntry[] = [
  { category: "Services Spéciaux", name: "Soin Visage Basic", durationMin: 35, price: 150 },
  { category: "Services Spéciaux", name: "Soin Hydrafacial Pro", durationMin: 50, price: 300 },
  { category: "Services Spéciaux", name: "Massage Relaxant Corps", durationMin: 45, price: 200 },
  { category: "Services Spéciaux", name: "Hijama Sec Traditionnel", durationMin: 30, price: 150 },
];

const EXTRA_SERVICES: ServiceCatalogEntry[] = [
  { category: "Extra Services", name: "Shampooing", durationMin: 10, price: 15 },
  { category: "Extra Services", name: "Gommage Visage", durationMin: 15, price: 40 },
  { category: "Extra Services", name: "Épilation Visage au fil", durationMin: 20, price: 60 },
  { category: "Extra Services", name: "Protéine Basic Homme", durationMin: 60, price: 150 },
  { category: "Extra Services", name: "Protéine Luxe Homme", durationMin: 90, price: 600 },
];

const SPA_SOINS_HOMME: ServiceCatalogEntry[] = [
  { category: "Spa & Soins Homme", name: "Hammam Turc", durationMin: 45, price: 130 },
  { category: "Spa & Soins Homme", name: "Hammam Royale Homme", durationMin: 60, price: 200 },
  { category: "Spa & Soins Homme", name: "Hammam Silver d'Exception", durationMin: 75, price: 250 },
  { category: "Spa & Soins Homme", name: "Pédicure Médicale Homme", durationMin: 50, price: 200 },
  { category: "Spa & Soins Homme", name: "Manucure Homme", durationMin: 30, price: 50 },
];

const VIP: ServiceCatalogEntry[] = [
  ...SOINS_CHEVEUX,
  ...SOIN_PROTEINE,
  ...COLORATION,
  ...ONGLERIE,
  ...HAMMAM_SPA,
  ...SOINS_VISAGE,
  ...REGARD,
  ...EPILATION,
];

const GOLD: ServiceCatalogEntry[] = [
  ...SOINS_CHEVEUX,
  ...SOIN_PROTEINE,
  ...COLORATION,
  ...ONGLERIE,
];

const BARBER: ServiceCatalogEntry[] = [
  ...COIFFURE_BARBE,
  ...SERVICES_SPECIAUX,
  ...EXTRA_SERVICES,
  ...SPA_SOINS_HOMME,
];

const CATALOG_BY_SLUG: Record<string, ServiceCatalogEntry[]> = {
  vip: VIP,
  gold: GOLD,
  barber: BARBER,
};

const FALLBACK: ServiceCatalogEntry[] = VIP;

export function getServicesForSalon(slug: string): ServiceCatalogEntry[] {
  return CATALOG_BY_SLUG[slug] ?? FALLBACK;
}

/** The catalogue entry a booked service refers to, however it was capitalised or spaced. */
export function findCatalogEntry(
  catalog: readonly ServiceCatalogEntry[],
  service: string,
): ServiceCatalogEntry | undefined {
  const key = service.trim().toLowerCase();
  return catalog.find((entry) => entry.name.trim().toLowerCase() === key);
}

/** Grouped in category order, for an `<optgroup>`-rendered `<select>`. */
export function groupedServicesForSalon(
  slug: string,
): { category: string; items: ServiceCatalogEntry[] }[] {
  return groupCatalog(getServicesForSalon(slug));
}

/** Any catalogue — static or the owner's live one — grouped in first-seen category order. */
export function groupCatalog(
  entries: readonly ServiceCatalogEntry[],
): { category: string; items: ServiceCatalogEntry[] }[] {
  const order: string[] = [];
  const byCategory = new Map<string, ServiceCatalogEntry[]>();
  for (const entry of entries) {
    if (!byCategory.has(entry.category)) {
      byCategory.set(entry.category, []);
      order.push(entry.category);
    }
    byCategory.get(entry.category)!.push(entry);
  }
  return order.map((category) => ({ category, items: byCategory.get(category)! }));
}
