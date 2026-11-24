import { z } from "zod";
import { TAX_REGIMES } from "./tax";

/**
 * What a printed bill / receipt shows, per branch (Settings › Bill). Applied by
 * both the browser bill (receipt.html.ts) and the thermal-printer bill
 * (escpos-receipt.ts), so every printer shows the same thing.
 *
 * The branch's own name, address, phone, GSTIN and tax name live on the branch
 * row; these switches only decide whether and how each part is printed.
 * Every field has a default, so an empty/old value means "the standard bill".
 */
export const billSettingsSchema = z.object({
  // Header
  showRestaurantName: z.boolean().default(true),
  showBranchName: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  showPhone: z.boolean().default(true),
  /** GSTIN / VAT No. / tax id line. */
  showTaxId: z.boolean().default(true),
  /** Extra line under the header, e.g. "Pure veg · Since 1990". */
  headerNote: z.string().trim().max(120).default(""),
  /** Title above the order details, e.g. "TAX INVOICE". Empty = none. */
  billTitle: z.string().trim().max(40).default(""),
  // Order details
  showOrderType: z.boolean().default(true),
  showTable: z.boolean().default(true),
  showCustomer: z.boolean().default(true),
  // Tax. false = a bill without tax lines (prices are unchanged, only the
  // printout leaves the tax out).
  showTaxBreakup: z.boolean().default(true),
  /** "GST @ 5%" under each item (only when showTaxBreakup). */
  showItemTax: z.boolean().default(true),
  // Footer
  footerText: z.string().trim().max(160).default("Thank you! Visit again."),
});
export type BillSettings = z.infer<typeof billSettingsSchema>;

export const DEFAULT_BILL_SETTINGS: BillSettings = billSettingsSchema.parse({});

/** The stored value (JSON column, possibly null or from an older version) as full settings. */
export function resolveBillSettings(raw: unknown): BillSettings {
  const parsed = billSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_BILL_SETTINGS;
}

/**
 * Settings › Bill live preview: the switches being edited plus the branch's
 * header fields as typed (not saved yet). The server renders a sample bill.
 */
export const billPreviewRequestSchema = z.object({
  bill: billSettingsSchema,
  branch: z
    .object({
      address: z.string().max(300).nullable(),
      phone: z.string().max(40).nullable(),
      gstNumber: z.string().max(50).nullable(),
      taxLabel: z.string().max(30).nullable(),
      taxRegime: z.enum(TAX_REGIMES),
    })
    .partial()
    .default({}),
});
export type BillPreviewRequest = z.infer<typeof billPreviewRequestSchema>;
