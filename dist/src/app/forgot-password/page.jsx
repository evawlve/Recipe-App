"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ForgotPasswordPage;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const zod_1 = require("zod");
const react_hook_form_1 = require("react-hook-form");
const zod_2 = require("@hookform/resolvers/zod");
const client_1 = require("@/lib/supabase/client");
const input_1 = require("@/components/ui/input");
const button_1 = require("@/components/ui/button");
const schema = zod_1.z.object({ email: zod_1.z.string().email("Enter a valid email") });
function ForgotPasswordPage() {
    const router = (0, navigation_1.useRouter)();
    const [submitted, setSubmitted] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)("");
    const form = (0, react_hook_form_1.useForm)({ resolver: (0, zod_2.zodResolver)(schema), defaultValues: { email: "" } });
    async function onSubmit(values) {
        setError("");
        const supabase = (0, client_1.createSupabaseBrowserClient)();
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
    return (<div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 shadow-sm">
        <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] mb-4">Reset password</h1>
        {submitted ? (<p className="text-sm text-[var(--text)]">Check your email for a password reset link.</p>) : (<form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--text)]">Email</label>
              <input_1.Input id="email" type="email" {...form.register("email")} className="h-12 rounded-xl bg-[var(--bg)] border-[var(--border)] focus-visible:ring-[var(--ring)]"/>
              {form.formState.errors.email?.message ? (<p className="text-xs mt-1 text-destructive">{form.formState.errors.email?.message}</p>) : null}
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <button_1.Button type="submit" className="w-full h-10 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold">Send reset link</button_1.Button>
          </form>)}
      </div>
    </div>);
}
