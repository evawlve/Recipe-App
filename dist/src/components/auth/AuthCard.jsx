"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AuthCard;
const react_1 = require("react");
const link_1 = __importDefault(require("next/link"));
const zod_1 = require("zod");
const react_hook_form_1 = require("react-hook-form");
const zod_2 = require("@hookform/resolvers/zod");
const navigation_1 = require("next/navigation");
const client_1 = require("@/lib/supabase/client");
const input_1 = require("@/components/ui/input");
const button_1 = require("@/components/ui/button");
const label_1 = require("@/components/ui/label");
const Logo_1 = __importDefault(require("@/components/Logo"));
const credentialsSchema = zod_1.z.object({
    email: zod_1.z.string().email("Enter a valid email"),
    password: zod_1.z.string().min(8, "At least 8 characters"),
});
function AuthCard({ title, mode, showForgot = false, logoSrc = "/logo.svg" }) {
    const router = (0, navigation_1.useRouter)();
    const searchParams = (0, navigation_1.useSearchParams)();
    const redirectTo = searchParams.get("redirectTo") || "/recipes";
    const [serverError, setServerError] = (0, react_1.useState)("");
    const [submitting, setSubmitting] = (0, react_1.useState)(false);
    const [oauthLoading, setOauthLoading] = (0, react_1.useState)(false);
    const form = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_2.zodResolver)(credentialsSchema),
        defaultValues: { email: "", password: "" },
    });
    async function onSubmit(values) {
        setSubmitting(true);
        setServerError("");
        const supabase = (0, client_1.createSupabaseBrowserClient)();
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
            }
            else {
                const { error } = await supabase.auth.signUp({
                    email: values.email,
                    password: values.password,
                    options: {
                        emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
                    },
                });
                if (error) {
                    setServerError(error.message);
                    return;
                }
            }
            router.replace(redirectTo);
        }
        finally {
            setSubmitting(false);
        }
    }
    async function handleGoogle() {
        setOauthLoading(true);
        setServerError("");
        const supabase = (0, client_1.createSupabaseBrowserClient)();
        try {
            const origin = typeof window !== "undefined" ? window.location.origin : "";
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: origin ? `${origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}` : undefined },
            });
            if (error)
                setServerError(error.message);
        }
        finally {
            setOauthLoading(false);
        }
    }
    const emailError = form.formState.errors.email?.message;
    const passwordError = form.formState.errors.password?.message;
    return (<div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
      <div className="mb-6 flex flex-col items-center gap-3">
        <Logo_1.default withText size="lg"/>
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">{title}</h1>
      </div>

      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <label_1.Label htmlFor="email">Email</label_1.Label>
          <input_1.Input id="email" type="email" {...form.register("email")} aria-invalid={!!emailError} aria-describedby={emailError ? "email-error" : undefined} placeholder="Enter your email" className="h-12 rounded-xl bg-background border-border focus-visible:ring-ring"/>
          {emailError ? (<p id="email-error" className="text-xs mt-1 text-destructive">{emailError}</p>) : null}
        </div>

        <div className="space-y-2">
          <label_1.Label htmlFor="password">Password</label_1.Label>
          <input_1.Input id="password" type="password" {...form.register("password")} aria-invalid={!!passwordError} aria-describedby={passwordError ? "password-error" : undefined} placeholder="Enter your password" className="h-12 rounded-xl bg-background border-border focus-visible:ring-ring"/>
          {passwordError ? (<p id="password-error" className="text-xs mt-1 text-destructive">{passwordError}</p>) : null}
        </div>

        {serverError ? (<p className="text-xs text-destructive">{serverError}</p>) : null}

        <button_1.Button type="submit" disabled={submitting} className="w-full h-10 rounded-xl bg-primary text-primary-foreground font-semibold border-2 border-green-500 hover:border-green-600">
          {mode === "signin" ? (submitting ? "Signing in..." : "Sign in") : (submitting ? "Creating..." : "Create account")}
        </button_1.Button>
      </form>

      <div className="my-4">
        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border"/></div>
          <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-card px-2 text-muted-foreground">Or continue with</span></div>
        </div>
      </div>

      <button_1.Button type="button" variant="outline" disabled={oauthLoading} onClick={handleGoogle} className="w-full h-10 rounded-xl border-border">
        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {oauthLoading ? "Continuing..." : "Continue with Google"}
      </button_1.Button>

      <div className="mt-4 flex items-center justify-between text-sm">
        {showForgot ? (<link_1.default href="/forgot-password" className="underline">Forgot password?</link_1.default>) : <span />}
        {mode === "signin" ? (<link_1.default href="/signup" className="text-primary hover:text-primary/80 font-medium">Create account</link_1.default>) : (<link_1.default href="/signin" className="text-primary hover:text-primary/80 font-medium">Sign in</link_1.default>)}
      </div>
    </div>);
}
