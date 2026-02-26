import enMessages from "@/messages/en.json";
import arMessages from "@/messages/ar.json";

export type Locale = "en" | "ar";

export const locales: Locale[] = ["en", "ar"];

export const defaultLocale: Locale = "ar";

const messages: Record<Locale, typeof enMessages> = {
  en: enMessages,
  ar: arMessages,
};

export function getMessages(locale: Locale) {
  return messages[locale] || messages[defaultLocale];
}

export function getDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? `${K}.${NestedKeyOf<T[K]>}`
        : K;
    }[keyof T & string]
  : never;

export type TranslationKey = NestedKeyOf<typeof enMessages>;

export function t(locale: Locale, key: string): string {
  const parts = key.split(".");
  let current: unknown = messages[locale] || messages[defaultLocale];

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }

  return typeof current === "string" ? current : key;
}
