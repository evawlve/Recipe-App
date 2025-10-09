"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";

type AuthMode = "signin" | "signup";

export type AuthCardProps = {
  title: string;
  mode: AuthMode;
  showForgot?: boolean;
  logoSrc?: string; // optional override
};

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type CredentialsInput = z.infer<typeof credentialsSchema>;

export default function AuthCard({ title, mode, showForgot = false, logoSrc = "/logo.svg" }: AuthCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/recipes";
  const [serverError, setServerError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  const form = useForm<CredentialsInput>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: CredentialsInput) {
    setSubmitting(true);
    setServerError("");
    const supabase = createSupabaseBrowserClient();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
        });
        if (error) {
          setServerError(error.message || "Incorrect email or password");
          return;
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(
              redirectTo
            )}`,
          },
        });
        if (error) {
          setServerError(error.message);
          return;
        }
      }
      router.replace(redirectTo);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setOauthLoading(true);
    setServerError("");
    const supabase = createSupabaseBrowserClient();
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: origin ? `${origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}` : undefined },
      });
      if (error) setServerError(error.message);
    } finally {
      setOauthLoading(false);
    }
  }

  const emailError = form.formState.errors.email?.message;
  const passwordError = form.formState.errors.password?.message;

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
      <div className="mb-6 flex flex-col items-center gap-3">
        <Logo withText size="lg" />
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">{title}</h1>
      </div>

      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            {...form.register("email")}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? "email-error" : undefined}
            placeholder="Enter your email"
            className="h-12 rounded-xl bg-background border-border focus-visible:ring-ring"
          />
          {emailError ? (
            <p id="email-error" className="text-xs mt-1 text-destructive">{emailError}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            {...form.register("password")}
            aria-invalid={!!passwordError}
            aria-describedby={passwordError ? "password-error" : undefined}
            placeholder="Enter your password"
            className="h-12 rounded-xl bg-background border-border focus-visible:ring-ring"
          />
          {passwordError ? (
            <p id="password-error" className="text-xs mt-1 text-destructive">{passwordError}</p>
          ) : null}
        </div>

        {serverError ? (
          <p className="text-xs text-destructive">{serverError}</p>
        ) : null}

        <Button type="submit" disabled={submitting} className="w-full h-10 rounded-xl bg-primary text-primary-foreground font-semibold border-2 border-green-500 hover:border-green-600">
          {mode === "signin" ? (submitting ? "Signing in..." : "Sign in") : (submitting ? "Creating..." : "Create account")}
        </Button>
      </form>

      <div className="my-4">
        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
          <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-card px-2 text-muted-foreground">Or continue with</span></div>
        </div>
      </div>

      <Button type="button" variant="outline" disabled={oauthLoading} onClick={handleGoogle} className="w-full h-10 rounded-xl border-border">
        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {oauthLoading ? "Continuing..." : "Continue with Google"}
      </Button>

      <div className="mt-4 flex items-center justify-between text-sm">
        {showForgot ? (
          <Link href="/forgot-password" className="underline">Forgot password?</Link>
        ) : <span />}
        {mode === "signin" ? (
          <Link href="/signup" className="text-primary hover:text-primary/80 font-medium">Create account</Link>
        ) : (
          <Link href="/signin" className="text-primary hover:text-primary/80 font-medium">Sign in</Link>
        )}
      </div>
    </div>
  );
}


