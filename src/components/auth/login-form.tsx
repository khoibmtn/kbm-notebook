"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n-client";
import { createLoginSchema, safeNext, type LoginInput } from "@/lib/validators/auth";

export function LoginForm({ next, googleEnabled }: { next?: string; googleEnabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const target = safeNext(next);
  const [error, setError] = useState<string | null>(null);
  const schema = useMemo(() => createLoginSchema(t), [t]);
  const form = useForm<LoginInput>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  async function onSubmit(values: LoginInput) {
    setError(null);
    const res = await authClient.signIn.email({ email: values.email, password: values.password });
    if (res.error) {
      setError(res.error.status === 401 || res.error.status === 400 ? t("auth.login.invalid") : (res.error.message ?? t("common.error")));
      return;
    }
    router.replace(target);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1} className="text-xl">{t("auth.login.title")}</CardTitle>
        <CardDescription>{t("auth.login.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("auth.email")}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" placeholder="ban@vi-du.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("auth.password")}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
              {t("auth.login.submit")}
            </Button>
          </form>
        </Form>
        {googleEnabled && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              {t("auth.or")}
              <Separator className="flex-1" />
            </div>
            <GoogleButton callbackURL={target} />
          </>
        )}
        <p className="text-center text-sm text-muted-foreground">
          {t("auth.login.noAccount")}{" "}
          <Link href={next ? `/register?next=${encodeURIComponent(target)}` : "/register"} className="font-medium text-primary hover:underline">
            {t("auth.register.title")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
