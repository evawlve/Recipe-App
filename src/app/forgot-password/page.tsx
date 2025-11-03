"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";

const schema = z.object({ email: z.string().email("Enter a valid email") });
type InputType = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<InputType>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  async function onSubmit(values: InputType) {
    setError("");
    setIsSubmitting(true);
    
    try {
      const supabase = createSupabaseBrowserClient();
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      
      // Use the update-password page as the redirect destination
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: origin ? `${origin}/update-password` : undefined,
      });
      
      if (error) {
        setError(error.message);
        return;
      }
      
      // Always show success message for security (don't reveal if email exists)
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
        <div className="-mt-12 mb-4 flex flex-col items-center">
          <Logo withText size="xl" />
          <h1 className="-mt-8 text-xl sm:text-2xl font-semibold text-foreground">Reset password</h1>
        </div>

        {submitted ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
              <p className="text-sm text-green-800 dark:text-green-200">
                ✓ If an account exists with this email, you will receive a password reset link shortly.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Didn't receive the email? Check your spam folder or try again in a few minutes.
            </p>
            <Button 
              onClick={() => router.push("/signin")} 
              variant="outline"
              className="w-full h-10 rounded-xl"
            >
              Back to Sign in
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-4">
                Enter your email address and we'll send you a link to reset your password.
              </p>
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                {...form.register("email")} 
                placeholder="Enter your email"
                className="h-12 rounded-xl bg-background border-border focus-visible:ring-ring" 
              />
              {form.formState.errors.email?.message ? (
                <p className="text-xs mt-1 text-destructive">{form.formState.errors.email?.message}</p>
              ) : null}
            </div>
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
            <Button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full h-10 rounded-xl bg-primary text-primary-foreground font-semibold border-2 border-green-500 hover:border-green-600"
            >
              {isSubmitting ? "Sending..." : "Send reset link"}
            </Button>
            <Button 
              type="button"
              onClick={() => router.push("/signin")} 
              variant="outline"
              className="w-full h-10 rounded-xl"
            >
              Back to Sign in
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}


