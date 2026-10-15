import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getLocale } from "@/i18n/server";
import { t } from "@/lib/i18n";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "vietnamese"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "KBM Notebook", template: "%s · KBM Notebook" },
  description: t("app.description"),
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
