"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthHeader = AuthHeader;
const react_1 = require("react");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const button_1 = require("@/components/ui/button");
const client_1 = require("@/lib/supabase/client");
const auth_utils_1 = require("@/lib/auth-utils");
const EnhancedSearchBox_1 = require("@/components/recipes/EnhancedSearchBox");
const Logo_1 = __importDefault(require("@/components/Logo"));
const lucide_react_1 = require("lucide-react");
const NotificationBell_1 = __importDefault(require("@/components/NotificationBell"));
function AuthHeader() {
    const pathname = (0, navigation_1.usePathname)();
    const [user, setUser] = (0, react_1.useState)(null);
    const [isLoading, setIsLoading] = (0, react_1.useState)(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = (0, react_1.useState)(false);
    const [isNavbarVisible, setIsNavbarVisible] = (0, react_1.useState)(true);
    const [lastScrollY, setLastScrollY] = (0, react_1.useState)(0);
    // Check if we're on signup page
    const isSignupPage = pathname === '/signup';
    // Smart sticky navbar scroll detection
    (0, react_1.useEffect)(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            // Show navbar when scrolling up or at the top
            if (currentScrollY < lastScrollY || currentScrollY < 10) {
                setIsNavbarVisible(true);
            }
            // Hide navbar when scrolling down (but only after scrolling past 100px)
            else if (currentScrollY > lastScrollY && currentScrollY > 100) {
                setIsNavbarVisible(false);
            }
            setLastScrollY(currentScrollY);
        };
        // Only add scroll listener on client side
        if (typeof window !== 'undefined') {
            window.addEventListener('scroll', handleScroll, { passive: true });
            return () => window.removeEventListener('scroll', handleScroll);
        }
    }, [lastScrollY]);
    (0, react_1.useEffect)(() => {
        async function getUser() {
            try {
                const supabase = (0, client_1.createSupabaseBrowserClient)();
                const { data: { user: authUser }, error } = await supabase.auth.getUser();
                if (error) {
                    // Handle specific auth errors
                    if ((0, auth_utils_1.isTokenError)(error) || error.message?.includes('Auth session missing')) {
                        // Clear invalid session and redirect
                        await supabase.auth.signOut();
                        setUser(null);
                    }
                    else {
                        console.error('Auth error:', error);
                        setUser(null);
                    }
                }
                else if (!authUser) {
                    setUser(null);
                }
                else {
                    // Fetch user data from our database to get the latest name
                    try {
                        const response = await fetch('/api/whoami');
                        if (response.ok) {
                            const userData = await response.json();
                            setUser({
                                id: userData.id,
                                email: userData.email,
                                name: userData.name,
                                avatarUrl: userData.avatarUrl,
                            });
                        }
                        else {
                            // Fallback to Supabase metadata if API fails
                            setUser({
                                id: authUser.id,
                                email: authUser.email || '',
                                name: authUser.user_metadata?.name || authUser.email || 'User',
                            });
                        }
                    }
                    catch (apiError) {
                        console.error('Error fetching user from API:', apiError);
                        // Fallback to Supabase metadata
                        setUser({
                            id: authUser.id,
                            email: authUser.email || '',
                            name: authUser.user_metadata?.name || authUser.email || 'User',
                        });
                    }
                }
            }
            catch (error) {
                console.error('Error getting user:', error);
                setUser(null);
            }
            finally {
                setIsLoading(false);
            }
        }
        // Only run on client side
        if (typeof window !== 'undefined') {
            // Check if we're already on a public page to avoid unnecessary auth checks
            const isPublicPage = window.location.pathname === '/signin' ||
                window.location.pathname === '/signup' ||
                window.location.pathname === '/forgot-password';
            if (!isPublicPage) {
                getUser();
            }
            else {
                setIsLoading(false);
            }
            // Listen for auth changes
            try {
                const supabase = (0, client_1.createSupabaseBrowserClient)();
                const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
                    try {
                        if (event === 'SIGNED_OUT' || !session?.user) {
                            setUser(null);
                        }
                        else if (session?.user) {
                            // Fetch user data from our database to get the latest name
                            try {
                                const response = await fetch('/api/whoami');
                                if (response.ok) {
                                    const userData = await response.json();
                                    setUser({
                                        id: userData.id,
                                        email: userData.email,
                                        name: userData.name,
                                        avatarUrl: userData.avatarUrl,
                                    });
                                }
                                else {
                                    // Fallback to Supabase metadata if API fails
                                    setUser({
                                        id: session.user.id,
                                        email: session.user.email || '',
                                        name: session.user.user_metadata?.name || session.user.email || 'User',
                                    });
                                }
                            }
                            catch (apiError) {
                                console.error('Error fetching user from API:', apiError);
                                // Fallback to Supabase metadata
                                setUser({
                                    id: session.user.id,
                                    email: session.user.email || '',
                                    name: session.user.user_metadata?.name || session.user.email || 'User',
                                });
                            }
                        }
                    }
                    catch (authError) {
                        console.error('Auth state change error:', authError);
                        setUser(null);
                    }
                });
                return () => subscription.unsubscribe();
            }
            catch (error) {
                console.error('Error setting up auth listener:', error);
                setIsLoading(false);
            }
        }
        else {
            setIsLoading(false);
        }
    }, []);
    const handleSignOut = async () => {
        try {
            const supabase = (0, client_1.createSupabaseBrowserClient)();
            await supabase.auth.signOut();
            // Force redirect to sign in page
            window.location.href = '/signin';
        }
        catch (error) {
            console.error('Error signing out:', error);
            // Still redirect even if there's an error
            window.location.href = '/signin';
        }
    };
    return (<header className={`fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border transition-transform duration-300 ${isNavbarVisible ? 'translate-y-0' : '-translate-y-full'}`}>
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Left side - Logo and Navigation */}
          <div className="flex items-center gap-8">
            {isSignupPage ? (<div className="flex items-center gap-2 cursor-not-allowed opacity-50 relative group">
                <Logo_1.default size="md"/>
                <span className="text-2xl font-bold text-foreground">Mealspire</span>
                {/* Tooltip */}
                <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Complete setup to access home
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>) : (<link_1.default href="/" className="flex items-center gap-2">
                <Logo_1.default size="md"/>
                <span className="text-2xl font-bold text-foreground">Mealspire</span>
              </link_1.default>)}
            
            {/* Navigation Links */}
            <nav className="hidden lg:flex items-center gap-6">
              {isSignupPage ? (
        // Disabled navigation during signup
        <>
                  <span className="text-muted-foreground/50 font-medium cursor-not-allowed">
                    Home
                  </span>
                  <span className="text-muted-foreground/50 font-medium cursor-not-allowed">
                    Explore
                  </span>
                  <span className="text-muted-foreground/50 font-medium cursor-not-allowed">
                    Create
                  </span>
                </>) : (
        // Normal navigation
        <>
                  <link_1.default href="/" className="text-muted-foreground hover:text-foreground font-medium transition-colors">
                    Home
                  </link_1.default>
                  <link_1.default href="/recipes" className="text-muted-foreground hover:text-foreground font-medium transition-colors">
                    Explore
                  </link_1.default>
                  <link_1.default href="/recipes/new" className="text-muted-foreground hover:text-foreground font-medium transition-colors">
                    Create
                  </link_1.default>
                </>)}
            </nav>
          </div>

          {/* Right side - Search, Notifications, Avatar */}
          <div className="flex items-center gap-4">
            {/* Search Bar */}
            <div className="hidden lg:block">
              {isSignupPage ? (<div className="relative">
                  <div className="w-64 h-10 bg-muted/50 border border-border/50 rounded-lg flex items-center px-3 text-muted-foreground/50 cursor-not-allowed">
                    <lucide_react_1.Search className="h-4 w-4 mr-2"/>
                    <span className="text-sm">Complete setup to search...</span>
                  </div>
                </div>) : (<EnhancedSearchBox_1.EnhancedSearchBox />)}
            </div>

            {/* Notifications Button */}
            {isSignupPage ? (<div className="hidden lg:flex h-10 w-10 p-0 bg-muted/50 rounded-lg cursor-not-allowed opacity-50 relative group items-center justify-center">
                <lucide_react_1.Bell className="h-4 w-4 text-muted-foreground/50"/>
                {/* Tooltip */}
                <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Complete setup to access notifications
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>) : user ? (<div className="hidden lg:flex">
                <NotificationBell_1.default />
              </div>) : null}

            {/* User Avatar or Sign In */}
            {isLoading ? (<div className="animate-pulse bg-muted h-10 w-10 rounded-full"></div>) : user ? (isSignupPage ? (
        // Disabled avatar during signup
        <div className="flex items-center cursor-not-allowed opacity-50">
                  {user.avatarUrl ? (<img src={user.avatarUrl} alt={user.name || user.email} className="h-10 w-10 rounded-full object-cover border-2 border-border"/>) : (<div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-sm font-medium text-muted-foreground">
                        {(user.name || user.email)[0].toUpperCase()}
                      </span>
                    </div>)}
                </div>) : (<link_1.default href="/me" className="flex items-center">
                  {user.avatarUrl ? (<img src={user.avatarUrl} alt={user.name || user.email} className="h-10 w-10 rounded-full object-cover border-2 border-border"/>) : (<div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-sm font-medium text-muted-foreground">
                        {(user.name || user.email)[0].toUpperCase()}
                      </span>
                    </div>)}
                </link_1.default>)) : (<button_1.Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <link_1.default href="/signin">Sign In</link_1.default>
              </button_1.Button>)}

            {/* Mobile Menu Button */}
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="lg:hidden p-2 rounded-md hover:bg-muted transition-colors" aria-label="Toggle mobile menu">
              {isMobileMenuOpen ? (<lucide_react_1.X className="h-6 w-6"/>) : (<lucide_react_1.Menu className="h-6 w-6"/>)}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (<div className="lg:hidden mt-4 pb-4 border-t border-border pt-4">
            <nav className="flex flex-col space-y-4">
              <link_1.default href="/" className="text-muted-foreground hover:text-foreground font-medium py-2" onClick={() => setIsMobileMenuOpen(false)}>
                Home
              </link_1.default>
              <link_1.default href="/recipes" className="text-muted-foreground hover:text-foreground font-medium py-2" onClick={() => setIsMobileMenuOpen(false)}>
                Explore
              </link_1.default>
              <link_1.default href="/recipes/new" className="text-muted-foreground hover:text-foreground font-medium py-2" onClick={() => setIsMobileMenuOpen(false)}>
                Create
              </link_1.default>
              
              {/* Mobile Search */}
              <div className="mt-4">
                {isSignupPage ? (<div className="w-full h-10 bg-muted/50 border border-border/50 rounded-lg flex items-center px-3 text-muted-foreground/50 cursor-not-allowed">
                    <lucide_react_1.Search className="h-4 w-4 mr-2"/>
                    <span className="text-sm">Complete setup to search...</span>
                  </div>) : (<EnhancedSearchBox_1.EnhancedSearchBox className="w-full"/>)}
              </div>
              
              {/* Mobile Notifications */}
              {user && !isSignupPage && (<div className="mt-4">
                  <NotificationBell_1.default />
                </div>)}
              
              {user && (<div className="flex flex-col space-y-4 pt-4 border-t border-border">
                  <button_1.Button variant="outline" onClick={handleSignOut} className="w-full">
                    Sign Out
                  </button_1.Button>
                </div>)}
            </nav>
          </div>)}
      </div>
    </header>);
}
