"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";
import PasswordStrengthIndicator from "@/components/auth/PasswordStrengthIndicator";
import { validatePassword } from "@/lib/auth/password-validation";

const schema = z.object({
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .refine((password) => {
      const strength = validatePassword(password);
      return strength.isValid;
    }, {
      message: "Password does not meet security requirements",
    }),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof schema>;

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const passwordValue = form.watch("password");

  useEffect(() => {
    // Check if user has a valid recovery session
    const checkSession = async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        setIsValidSession(true);
      } else {
        // No valid session, redirect to forgot password
        router.push("/forgot-password");
      }
      setIsLoading(false);
    };

    checkSession();
  }, [router]);

  async function onSubmit(values: FormData) {
    setError("");
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({
        password: values.password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      // Success - redirect to signin with message
      router.push("/signin?message=" + encodeURIComponent("Your password has been updated successfully. Please sign in."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg)]">
        <div className="text-center">
          <Logo withText size="xl" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isValidSession) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
        <div className="-mt-12 mb-4 flex flex-col items-center">
          <Logo withText size="xl" />
          <h1 className="-mt-8 text-xl sm:text-2xl font-semibold text-foreground">
            Update your password
          </h1>
        </div>

        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              type="password"
              {...form.register("password")}
              placeholder="Enter new password"
              className="h-12 rounded-xl bg-background border-border focus-visible:ring-ring"
            />
            {form.formState.errors.password?.message ? (
              <p className="text-xs mt-1 text-destructive">
                {form.formState.errors.password?.message}
              </p>
            ) : null}
            
            <PasswordStrengthIndicator 
              password={passwordValue || ""} 
              showRequirements={true}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              {...form.register("confirmPassword")}
              placeholder="Confirm new password"
              className="h-12 rounded-xl bg-background border-border focus-visible:ring-ring"
            />
            {form.formState.errors.confirmPassword?.message ? (
              <p className="text-xs mt-1 text-destructive">
                {form.formState.errors.confirmPassword?.message}
              </p>
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
            {isSubmitting ? "Updating..." : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}

