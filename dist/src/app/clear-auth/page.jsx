"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ClearAuthPage;
const react_1 = require("react");
const client_1 = require("@/lib/supabase/client");
const navigation_1 = require("next/navigation");
function ClearAuthPage() {
    const router = (0, navigation_1.useRouter)();
    (0, react_1.useEffect)(() => {
        const clearAuth = async () => {
            try {
                const supabase = (0, client_1.createSupabaseBrowserClient)();
                await supabase.auth.signOut();
                // Clear all storage
                localStorage.clear();
                sessionStorage.clear();
                console.log('Auth cleared successfully');
                // Redirect to home
                router.push('/');
            }
            catch (error) {
                console.error('Error clearing auth:', error);
                // Still redirect even if there's an error
                router.push('/');
            }
        };
        clearAuth();
    }, [router]);
    return (<div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Clearing Authentication...</h1>
        <p className="text-muted-foreground">Redirecting to home page...</p>
      </div>
    </div>);
}
