import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, makeT, type Locale } from "@/lib/i18n";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Dịch cho Server Component. */
export async function getT() {
  return makeT(await getLocale());
}
