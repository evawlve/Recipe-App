"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("password123");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

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
            setMessage(`Sign up failed: ${signUpError.message}`);
            console.error("Sign up error:", signUpError);
          } else {
            setMessage("User created successfully! You can now test RLS policies.");
            console.log("Sign up successful:", signUpData);
            // Redirect to RLS test page
            setTimeout(() => {
              window.location.href = "/rls-test";
            }, 1000);
          }
        } else {
          setMessage(`Sign in error: ${signInError.message}`);
        }
      } else {
        setMessage("Successfully signed in! You can now test RLS policies.");
        // Redirect to RLS test page
        setTimeout(() => {
          window.location.href = "/rls-test";
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
