"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const [email, setEmail] = useState("user@example.com");
  const [password, setPassword] = useState("password123");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/recipes';

  async function handleGoogleSignIn() {
    setLoading(true);
    setMessage("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`
        }
      });

      if (error) {
        setMessage(`Google sign in failed: ${error.message}`);
      } else {
        setMessage("Redirecting to Google...");
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const supabase = createSupabaseBrowserClient();
      
      // First try to sign in
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        // If sign in fails, try to sign up
        if (signInError.message.includes("Invalid login credentials")) {
          setMessage("User doesn't exist. Creating new user...");
          
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
          });

          if (signUpError) {
            if (signUpError.message.includes("Email address") && signUpError.message.includes("invalid")) {
              setMessage("Please use a valid email address (e.g., yourname@gmail.com)");
            } else {
              setMessage(`Sign up failed: ${signUpError.message}`);
            }
            console.error("Sign up error:", signUpError);
          } else {
            setMessage("User created successfully! Redirecting...");
            console.log("Sign up successful:", signUpData);
            // Redirect to intended page
            setTimeout(() => {
              router.push(redirectTo);
            }, 1000);
          }
        } else {
          setMessage(`Sign in error: ${signInError.message}`);
        }
      } else {
        setMessage("Successfully signed in! Redirecting...");
        // Redirect to intended page
        setTimeout(() => {
          router.push(redirectTo);
        }, 1000);
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    setMessage("Signed out successfully!");
  }

  async function checkAuthStatus() {
    const supabase = createSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      setMessage(`Currently signed in as: ${user.email}`);
    } else {
      setMessage("Not currently signed in");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Sign In</h1>
      <p className="text-sm text-muted-foreground">
        Sign in to test RLS policies. Use any email/password combination.
      </p>

      <form onSubmit={handleSignIn} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-primary text-white rounded-md disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-bg px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>

      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="w-full px-4 py-2 border border-border rounded-md hover:bg-muted disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {loading ? "Signing in..." : "Continue with Google"}
      </button>

      <div className="pt-4 space-y-2">
        <button
          onClick={checkAuthStatus}
          className="w-full px-4 py-2 border rounded-md"
        >
          Check Auth Status
        </button>
        <button
          onClick={() => setEmail("user@test.com")}
          className="w-full px-4 py-2 border rounded-md"
        >
          Try user@test.com
        </button>
        <button
          onClick={() => setEmail("admin@localhost")}
          className="w-full px-4 py-2 border rounded-md"
        >
          Try admin@localhost
        </button>
        <button
          onClick={handleSignOut}
          className="w-full px-4 py-2 border rounded-md"
        >
          Sign Out
        </button>
      </div>

      {message && (
        <div className="p-3 bg-muted rounded-md text-sm">{message}</div>
      )}

      <div className="text-sm text-muted-foreground">
        <p>For RLS testing, you can:</p>
        <ul className="list-disc pl-5 space-y-1 mt-1">
          <li>Sign in with any email/password</li>
          <li>Go to <code>/rls-test</code> to run RLS tests</li>
          <li>Test both signed-in and signed-out scenarios</li>
        </ul>
      </div>
    </div>
  );
}
