import { en } from "@/i18n/en";
import { vi, type MessageKey } from "@/i18n/vi";

export type Locale = "vi" | "en";
export type { MessageKey };

export const DEFAULT_LOCALE: Locale = "vi";
export const LOCALES: readonly Locale[] = ["vi", "en"] as const;
export const LOCALE_COOKIE = "kbm_locale";

const dictionaries: Record<Locale, Record<MessageKey, string>> = { vi, en };

export function isLocale(v: unknown): v is Locale {
  return v === "vi" || v === "en";
}

export type MessageParams = Record<string, string | number>;

/** Dịch khoá → chuỗi, thay {param}. Mặc định tiếng Việt; thiếu khoá ở `en` thì rơi về `vi`. */
export function t(key: MessageKey, params?: MessageParams, locale: Locale = DEFAULT_LOCALE): string {
  const template = dictionaries[locale][key] ?? vi[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function makeT(locale: Locale) {
  return (key: MessageKey, params?: MessageParams) => t(key, params, locale);
}
export type TFunction = ReturnType<typeof makeT>;
