import { createSupabaseServerClient } from "@/lib/supabase/server";
import AuthCard from "@/components/auth/AuthCard";
import { redirect } from "next/navigation";
import { Suspense } from "react";

// Force dynamic rendering for pages that use authentication
export const dynamic = 'force-dynamic';

type SearchParams = {
  message?: string;
  error?: string;
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/recipes");

  const params = await searchParams;
  const message = params.message;
  const error = params.error;

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <Suspense fallback={<div>Loading...</div>}>
        <AuthCard 
          title="Sign in" 
          mode="signin" 
          showForgot 
          initialMessage={message}
          initialError={error}
        />
      </Suspense>
    </div>
  );
}
