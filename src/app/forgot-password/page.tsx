"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const schema = z.object({ email: z.string().email("Enter a valid email") });
type InputType = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<InputType>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  async function onSubmit(values: InputType) {
    setError("");
    const supabase = createSupabaseBrowserClient();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: origin ? `${origin}/signin` : undefined,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setSubmitted(true);
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 shadow-sm">
        <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] mb-4">Reset password</h1>
        {submitted ? (
          <p className="text-sm text-[var(--text)]">Check your email for a password reset link.</p>
        ) : (
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--text)]">Email</label>
              <Input id="email" type="email" {...form.register("email")} className="h-12 rounded-xl bg-[var(--bg)] border-[var(--border)] focus-visible:ring-[var(--ring)]" />
              {form.formState.errors.email?.message ? (
                <p className="text-xs mt-1 text-destructive">{form.formState.errors.email?.message}</p>
              ) : null}
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full h-10 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold">Send reset link</Button>
          </form>
        )}
      </div>
    </div>
  );
}


