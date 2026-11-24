// Supported UI languages (2026-09-27). Adding a language: add its code
// here, drop a matching dictionary file in ./dictionaries, and it shows up
// in the language switcher automatically — no other code changes needed.
export const ALL_LOCALES = ["en", "ta", "es", "fr"] as const;
export type Locale = (typeof ALL_LOCALES)[number];

/**
 * The languages offered in the switcher (Kaappi Biller: English and Tamil).
 * Spanish and French are turned off, not removed: their dictionaries stay
 * (the kiosk still pins Spanish); add a code back here to offer it again.
 */
export const LOCALES: readonly Locale[] = ["en", "ta"];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ta: "தமிழ்",
  es: "Español",
  fr: "Français",
};

export const DEFAULT_LOCALE: Locale = "en";

/** An offered language (a saved or browser choice of a turned-off one falls back to English). */
export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
