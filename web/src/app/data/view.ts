export type DataView = "titles" | "promo";

export function parseView(raw?: string): DataView {
  if (raw === "promo") return "promo";
  return "titles";
}
