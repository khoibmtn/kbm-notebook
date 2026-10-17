"use client";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n-client";
import type { Locale } from "@/lib/i18n";

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider locale={locale}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </I18nProvider>
    </ThemeProvider>
  );
}
