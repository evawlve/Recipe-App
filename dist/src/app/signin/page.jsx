"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SignInPage;
const server_1 = require("@/lib/supabase/server");
const AuthCard_1 = __importDefault(require("@/components/auth/AuthCard"));
const navigation_1 = require("next/navigation");
const react_1 = require("react");
async function SignInPage() {
    const supabase = await (0, server_1.createSupabaseServerClient)();
    const { data: { user } } = await supabase.auth.getUser();
    if (user)
        (0, navigation_1.redirect)("/recipes");
    return (<div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <react_1.Suspense fallback={<div>Loading...</div>}>
        <AuthCard_1.default title="Sign in" mode="signin" showForgot/>
      </react_1.Suspense>
    </div>);
}
