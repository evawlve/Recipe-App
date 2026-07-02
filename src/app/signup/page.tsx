import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import SignUpFormClient from "./sign-up-form-client";
import { Suspense } from "react";

// Force dynamic rendering for pages that use authentication
export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  // Only redirect if user is authenticated AND has a username (profile is complete)
  if (user) {
    const dbUser = await getCurrentUser();
    if (dbUser?.username) {
      redirect("/recipes");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <Suspense fallback={<div>Loading...</div>}>
        <SignUpFormClient />
      </Suspense>
    </div>
  );
}


