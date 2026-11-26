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
/** Each logo is at most this many printer dots wide, so two fit side by side on 58 mm paper (384 dots). */
export const BILL_LOGO_MAX_DOTS = 184;
export const BILL_LOGO_MAX_ROWS = 160;

const base64Bytes = (s: string) => (s.length * 3) / 4 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);

/**
 * A logo on the bill, prepared in the browser when it is chosen (Settings ›
 * Bill), so the server needs no image library (also on the phone):
 * `image` for the screen/PDF bill, `raster` for thermal printers.
 */
export const billLogoSchema = z.object({
  /** Small PNG as a data URL. */
  image: z
    .string()
    .max(250_000, "The logo image is too large")
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, "The logo must be a PNG image"),
  /** 1-bit picture: rows of width/8 bytes, first bit = leftmost dot, 1 = black. */
  raster: z
    .object({
      width: z
        .number()
        .int()
        .min(8)
        .max(BILL_LOGO_MAX_DOTS)
        .refine((w) => w % 8 === 0, "width must be a multiple of 8"),
      height: z.number().int().min(1).max(BILL_LOGO_MAX_ROWS),
      data: z.string().max(10_000).regex(/^[A-Za-z0-9+/]+=*$/),
    })
    .refine((r) => base64Bytes(r.data) === (r.width / 8) * r.height, "The printer logo data is damaged"),
});
export type BillLogo = z.infer<typeof billLogoSchema>;

export const billSettingsSchema = z.object({
  // Header
  /** Logos at the top left and top right of the bill (either, both or none). */
  logoLeft: billLogoSchema.nullable().default(null),
  logoRight: billLogoSchema.nullable().default(null),
  /** Printed logo height in mm (thermal: 8 dots per mm, at most 160 dots). */
  logoSizeMm: z.number().int().min(10).max(30).default(16),
  /** Logos beside the shop details: level with the top, middle or bottom of the text. */
  logoAlign: z.enum(["top", "middle", "bottom"]).default("middle"),
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
  // Totals. One TOTAL line is always printed. The subtotal is printed only
  // when it differs from the total (a discount, tax or tip line between them).
  showSubtotal: z.boolean().default(true),
  /** "Paid (CASH) ₹250", received and change. */
  showPayments: z.boolean().default(true),
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
