import { BookOpenText } from "lucide-react";
import { getT } from "@/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BookOpenText className="size-5" />
        </span>
        {t("app.name")}
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
