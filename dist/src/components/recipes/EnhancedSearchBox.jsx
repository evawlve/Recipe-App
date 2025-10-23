"use strict";
'use client';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedSearchBox = EnhancedSearchBox;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const input_1 = require("@/components/ui/input");
const lucide_react_1 = require("lucide-react");
const card_1 = require("@/components/ui/card");
const image_1 = __importDefault(require("next/image"));
function EnhancedSearchBox({ className }) {
    const [query, setQuery] = (0, react_1.useState)('');
    const [suggestions, setSuggestions] = (0, react_1.useState)({ users: [], recipes: [] });
    const [isOpen, setIsOpen] = (0, react_1.useState)(false);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const [currentUser, setCurrentUser] = (0, react_1.useState)(null);
    const router = (0, navigation_1.useRouter)();
    const inputRef = (0, react_1.useRef)(null);
    const debounceRef = (0, react_1.useRef)(null);
    // Get current user information
    (0, react_1.useEffect)(() => {
        const getCurrentUser = async () => {
            try {
                const response = await fetch('/api/whoami');
                if (response.ok) {
                    const user = await response.json();
                    setCurrentUser(user);
                }
            }
            catch (error) {
                console.error('Error getting current user:', error);
            }
        };
        getCurrentUser();
    }, []);
    const searchUsers = (0, react_1.useCallback)(async (searchTerm) => {
        if (!searchTerm.trim()) {
            setSuggestions({ users: [], recipes: [] });
            return;
        }
        setIsLoading(true);
        try {
            const response = await fetch(`/api/users/search?q=${encodeURIComponent(searchTerm)}`);
            if (response.ok) {
                const users = await response.json();
                setSuggestions(prev => ({ ...prev, users }));
            }
        }
        catch (error) {
            console.error('Error searching users:', error);
        }
        finally {
            setIsLoading(false);
        }
    }, []);
    const handleInputChange = (0, react_1.useCallback)((e) => {
        const value = e.target.value;
        setQuery(value);
        // Clear previous debounce
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        // Debounce search
        debounceRef.current = setTimeout(() => {
            searchUsers(value);
        }, 200);
    }, [searchUsers]);
    const handleUserClick = (0, react_1.useCallback)((user) => {
        // Check if the clicked user is the current user
        if (currentUser && (currentUser.id === user.id || currentUser.username === user.username)) {
            router.push('/me');
        }
        else {
            router.push(`/u/${user.username}`);
        }
        setIsOpen(false);
        setQuery('');
    }, [router, currentUser]);
    const handleRecipeClick = (0, react_1.useCallback)((recipe) => {
        router.push(`/recipes/${recipe.id}`);
        setIsOpen(false);
        setQuery('');
    }, [router]);
    const handleSubmit = (0, react_1.useCallback)((e) => {
        e.preventDefault();
        if (query.trim()) {
            // For now, just search recipes
            router.push(`/recipes?q=${encodeURIComponent(query.trim())}`);
            setIsOpen(false);
            setQuery('');
        }
    }, [query, router]);
    const handleKeyDown = (0, react_1.useCallback)((e) => {
        if (e.key === 'Escape') {
            setIsOpen(false);
        }
    }, []);
    // Close suggestions when clicking outside
    (0, react_1.useEffect)(() => {
        const handleClickOutside = (event) => {
            if (inputRef.current && !inputRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    const hasSuggestions = suggestions.users.length > 0;
    return (<div className={`relative ${className}`} ref={inputRef}>
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <lucide_react_1.Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4"/>
          <input_1.Input ref={inputRef} type="text" placeholder="Search users..." value={query} onChange={handleInputChange} onKeyDown={handleKeyDown} onFocus={() => setIsOpen(true)} className="pl-10 pr-4 py-2 w-64 bg-muted border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"/>
        </div>
      </form>

      {/* Suggestions Dropdown */}
      {isOpen && (hasSuggestions || isLoading) && (<card_1.Card className="absolute top-full left-0 right-0 mt-2 z-50 max-h-96 overflow-y-auto">
          <card_1.CardContent className="p-0">
            {isLoading ? (<div className="p-4 text-center text-muted-foreground">
                Searching...
              </div>) : (<>
                {suggestions.users.length > 0 && (<div className="border-b border-border">
                    <div className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted/50">
                      Users
                    </div>
                    {suggestions.users.map((user) => (<button key={user.id} onClick={() => handleUserClick(user)} className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex items-center gap-3">
                        <div className="relative w-8 h-8 rounded-full overflow-hidden bg-gray-100">
                          {user.avatarKey ? (<image_1.default src={`/api/image/${user.avatarKey}`} alt={`${user.displayName || user.username} avatar`} fill className="object-cover"/>) : (<div className="w-full h-full bg-green-100 flex items-center justify-center text-sm font-bold text-green-600">
                              {(user.displayName || user.username).charAt(0).toUpperCase()}
                            </div>)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{user.displayName || user.username}</span>
                            <span className="text-sm text-muted-foreground">@{user.username}</span>
                          </div>
                        </div>
                        <lucide_react_1.User className="h-4 w-4 text-muted-foreground"/>
                      </button>))}
                  </div>)}
              </>)}
          </card_1.CardContent>
        </card_1.Card>)}
    </div>);
}
