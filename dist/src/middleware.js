"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.middleware = middleware;
const server_1 = require("next/server");
const ssr_1 = require("@supabase/ssr");
async function middleware(request) {
    const { pathname } = request.nextUrl;
    // Define protected routes
    const protectedRoutes = [
        '/recipes/new',
        '/recipes/[id]/edit',
        '/recipes/[id]/delete'
    ];
    // Check if current path is protected
    const isProtectedRoute = protectedRoutes.some(route => {
        if (route.includes('[id]')) {
            // Handle dynamic routes like /recipes/[id]/edit
            return pathname.match(/^\/recipes\/[^\/]+\/(edit|delete)$/);
        }
        return pathname === route;
    });
    if (isProtectedRoute) {
        try {
            const supabase = (0, ssr_1.createServerClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
                cookies: {
                    get(name) {
                        return request.cookies.get(name)?.value;
                    },
                    set(name, value, options) {
                        request.cookies.set({ name, value, ...options });
                    },
                    remove(name, options) {
                        request.cookies.set({ name, value: '', ...options });
                    },
                },
            });
            const { data: { user }, error } = await supabase.auth.getUser();
            if (error || !user) {
                // Redirect to signin page
                const signInUrl = new URL('/signin', request.url);
                signInUrl.searchParams.set('redirectTo', pathname);
                return server_1.NextResponse.redirect(signInUrl);
            }
        }
        catch (error) {
            // If there's an error checking auth, redirect to signin
            const signInUrl = new URL('/signin', request.url);
            signInUrl.searchParams.set('redirectTo', pathname);
            return server_1.NextResponse.redirect(signInUrl);
        }
    }
    return server_1.NextResponse.next();
}
exports.config = {
    matcher: [
        '/recipes/new',
        '/recipes/:path*/(edit|delete)',
    ],
};
