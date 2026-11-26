export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifierIds: string[];
  modifierLabel?: string;
  portion?: Portion;
  /** "Other item": typed in at the till, on this bill only (not on the menu). */
  openItemName?: string;
}

export type PortionKind = "HALF" | "FULL" | "CUSTOM";

export interface Portion {
  kind: PortionKind;
  // Only for CUSTOM: staff-typed label and unit price.
  customLabel?: string;
  customPrice?: number;
}

export function portionText(p?: Portion): string {
  if (!p) return "";
  if (p.kind === "HALF") return "Half";
  if (p.kind === "FULL") return "Full";
  return p.customLabel || "Custom";
}

export function cartLineKey(menuItemId: string, modifierIds: string[], portion?: Portion): string {
  const p = portion ? `${portion.kind}:${portion.customLabel ?? ""}:${portion.customPrice ?? ""}` : "";
  return `${menuItemId}::${[...modifierIds].sort().join(",")}::${p}`;
}
