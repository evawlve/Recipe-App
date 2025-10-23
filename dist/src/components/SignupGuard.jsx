"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignupGuard = SignupGuard;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const client_1 = require("@/lib/supabase/client");
function SignupGuard({ children }) {
    const router = (0, navigation_1.useRouter)();
    const pathname = (0, navigation_1.usePathname)();
    const [isChecking, setIsChecking] = (0, react_1.useState)(true);
    const [isAllowed, setIsAllowed] = (0, react_1.useState)(false);
    (0, react_1.useEffect)(() => {
        const checkSignupStatus = async () => {
            try {
                const supabase = (0, client_1.createSupabaseBrowserClient)();
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    // Not authenticated, allow access to public pages
                    setIsAllowed(true);
                    setIsChecking(false);
                    return;
                }
                // Check if user has completed profile setup (has username)
                const response = await fetch('/api/whoami');
                if (response.ok) {
                    const userData = await response.json();
                    console.log('SignupGuard: User data from whoami:', userData);
                    if (userData.username) {
                        // User has completed signup, allow access
                        console.log('SignupGuard: User has username, allowing access');
                        setIsAllowed(true);
                    }
                    else {
                        // User is authenticated but hasn't completed signup
                        console.log('SignupGuard: User missing username, redirecting to signup');
                        router.push('/signup?verified=true&email=' + encodeURIComponent(user.email || ''));
                        return;
                    }
                }
                else {
                    // API error, redirect to signup
                    router.push('/signup?verified=true&email=' + encodeURIComponent(user.email || ''));
                    return;
                }
            }
            catch (error) {
                console.error('Error checking signup status:', error);
                // On error, redirect to signup
                router.push('/signup');
                return;
            }
            finally {
                setIsChecking(false);
            }
        };
        // Only check on non-signup pages
        if (pathname !== '/signup' && pathname !== '/signin' && pathname !== '/forgot-password') {
            checkSignupStatus();
        }
        else {
            setIsAllowed(true);
            setIsChecking(false);
        }
    }, [pathname, router]);
    if (isChecking) {
        return (<div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full"></div>
      </div>);
    }
    if (!isAllowed) {
        return null; // Will redirect
    }
    return <>{children}</>;
}
