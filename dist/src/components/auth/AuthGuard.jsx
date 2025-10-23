"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthGuard = AuthGuard;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const client_1 = require("@/lib/supabase/client");
function AuthGuard({ children, redirectTo = '/signin' }) {
    const [isLoading, setIsLoading] = (0, react_1.useState)(true);
    const [isAuthenticated, setIsAuthenticated] = (0, react_1.useState)(false);
    const router = (0, navigation_1.useRouter)();
    const pathname = (0, navigation_1.usePathname)();
    (0, react_1.useEffect)(() => {
        async function checkAuth() {
            try {
                const supabase = (0, client_1.createSupabaseBrowserClient)();
                const { data: { user }, error } = await supabase.auth.getUser();
                if (error || !user) {
                    router.push(redirectTo);
                    return;
                }
                setIsAuthenticated(true);
            }
            catch (error) {
                console.error('Auth check error:', error);
                router.push(redirectTo);
            }
            finally {
                setIsLoading(false);
            }
        }
        checkAuth();
    }, [router, redirectTo]);
    (0, react_1.useEffect)(() => {
        const supabase = (0, client_1.createSupabaseBrowserClient)();
        const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') {
                if (pathname === '/recipes/new') {
                    router.replace('/');
                }
            }
        });
        return () => {
            subscription.subscription.unsubscribe();
        };
    }, [router, pathname]);
    if (isLoading) {
        return (<div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Checking authentication...</p>
        </div>
      </div>);
    }
    if (!isAuthenticated) {
        return null; // Will redirect
    }
    return <>{children}</>;
}
