import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import SignUpFormClient from "./sign-up-form-client";
import { Suspense } from "react";

export default async function SignUpPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/recipes");

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <Suspense fallback={<div>Loading...</div>}>
        <SignUpFormClient />
      </Suspense>
    </div>
  );
}


