"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseBrowserClient = createSupabaseBrowserClient;
const ssr_1 = require("@supabase/ssr");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
function createSupabaseBrowserClient() {
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing Supabase environment variables. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env file.');
    }
    return (0, ssr_1.createBrowserClient)(supabaseUrl, supabaseAnonKey, {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            flowType: 'pkce'
        }
    });
}
