import { z } from "zod";

/**
 * Menu › Upload JSON: a whole menu in one file. Categories are matched by
 * name and dishes by name inside their category (upper/lower case and extra
 * spaces ignored). New ones are added; a matching dish gets the file's price
 * (and description / veg / tax when the file gives them). Nothing is deleted.
 *
 *   {
 *     "taxRatePercent": 5,                      // optional, for every dish
 *     "menu": [
 *       { "category": "Hot Drinks",
 *         "serving": "1 cup",                   // optional, shown as the dish note
 *         "items": [
 *           { "name": "Filter Coffee", "price": 25 },
 *           { "name": "Egg Puff", "price": 30, "veg": false,
 *             "description": "Fresh from the oven", "taxRatePercent": 5,
 *             "halfPrice": 15 }
 *         ] }
 *     ]
 *   }
 *
 * Without "veg", a new dish is non-veg when its name says so (chicken, egg,
 * mutton, fish…), otherwise veg.
 */
const price = z.coerce.number({ message: "must be a number" }).nonnegative("can't be negative").max(1_000_000);
const taxRate = z.coerce.number({ message: "must be a number" }).min(0).max(100);

export const menuImportItemSchema = z.object({
  name: z.string().trim().min(1, "is empty").max(120),
  price,
  description: z.string().trim().max(500).optional(),
  veg: z.boolean().optional(),
  isVeg: z.boolean().optional(),
  taxRatePercent: taxRate.optional(),
  halfPrice: price.nullable().optional(),
});

export const menuImportCategorySchema = z.object({
  category: z.string().trim().min(1, "is empty").max(80),
  serving: z.string().trim().max(80).optional(),
  items: z.array(menuImportItemSchema).min(1, "has no items").max(500),
});

export const menuImportSchema = z.object({
  taxRatePercent: taxRate.optional(),
  menu: z.array(menuImportCategorySchema).min(1, "has no categories").max(100),
});
export type MenuImport = z.infer<typeof menuImportSchema>;

/** What an upload does (or did): shown as the preview and the result. */
export interface MenuImportResult {
  dryRun: boolean;
  categoriesCreated: string[];
  itemsCreated: { category: string; name: string; price: number; isVeg: boolean }[];
  itemsUpdated: { category: string; name: string; priceBefore: number; price: number }[];
  itemsUnchanged: number;
}

const NON_VEG_WORDS = /\b(chicken|egg|eggs|omelette|omlette|omlett|omelet|mutton|lamb|fish|prawns?|shrimp|crab|beef|pork|meat|keema|kheema)\b/i;

/** Veg flag for a dish: the file's choice, otherwise a guess from the name. */
export function guessIsVeg(name: string, given?: boolean): boolean {
  if (given !== undefined) return given;
  return !NON_VEG_WORDS.test(name);
}

/** Name key for matching: "  Filter  COFFEE " and "filter coffee" are the same dish. */
export function menuNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A ready-to-edit example file (Menu › Upload JSON › Download sample). */
export const MENU_IMPORT_SAMPLE: MenuImport = {
  taxRatePercent: 5,
  menu: [
    {
      category: "Hot Drinks",
      items: [
        { name: "Filter Coffee", price: 25 },
        { name: "Masala Tea", price: 20, description: "With ginger and cardamom" },
        { name: "Badam Milk", price: 30 },
      ],
    },
    {
      category: "Snacks",
      serving: "1 plate",
      items: [
        { name: "Veg Puff", price: 25 },
        { name: "Egg Puff", price: 30, veg: false },
        { name: "Samosa", price: 15 },
      ],
    },
    {
      category: "Momos",
      serving: "5 pcs / plate",
      items: [
        { name: "Veg Momos", price: 80 },
        { name: "Chicken Momos", price: 100, veg: false, taxRatePercent: 5 },
      ],
    },
  ],
};
