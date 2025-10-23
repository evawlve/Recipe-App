"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SignUpPage;
const navigation_1 = require("next/navigation");
const server_1 = require("@/lib/supabase/server");
const auth_1 = require("@/lib/auth");
const sign_up_form_client_1 = __importDefault(require("./sign-up-form-client"));
const react_1 = require("react");
async function SignUpPage() {
    const supabase = await (0, server_1.createSupabaseServerClient)();
    const { data: { user } } = await supabase.auth.getUser();
    // Only redirect if user is authenticated AND has a username (profile is complete)
    if (user) {
        const dbUser = await (0, auth_1.getCurrentUser)();
        if (dbUser?.username) {
            (0, navigation_1.redirect)("/recipes");
        }
    }
    return (<div className="min-h-screen grid place-items-center bg-[var(--bg)] px-4">
      <react_1.Suspense fallback={<div>Loading...</div>}>
        <sign_up_form_client_1.default />
      </react_1.Suspense>
    </div>);
}
