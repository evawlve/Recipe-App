"use strict";
'use client';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = NotificationBell;
const react_1 = require("react");
const link_1 = __importDefault(require("next/link"));
const lucide_react_1 = require("lucide-react");
const badge_1 = require("@/components/ui/badge");
function NotificationBell() {
    const [unreadCount, setUnreadCount] = (0, react_1.useState)(0);
    const [isLoading, setIsLoading] = (0, react_1.useState)(true);
    const fetchUnreadCount = async () => {
        try {
            const response = await fetch('/api/notifications/unread-count');
            if (response.ok) {
                const data = await response.json();
                setUnreadCount(data.unread);
            }
        }
        catch (error) {
            console.error('Failed to fetch unread count:', error);
        }
        finally {
            setIsLoading(false);
        }
    };
    (0, react_1.useEffect)(() => {
        fetchUnreadCount();
        // Poll every 30 seconds
        const interval = setInterval(fetchUnreadCount, 30000);
        // Also refetch when window regains focus
        const handleFocus = () => fetchUnreadCount();
        window.addEventListener('focus', handleFocus);
        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
        };
    }, []);
    return (<link_1.default href="/notifications" className="relative">
      <lucide_react_1.Bell className="h-6 w-6 text-gray-600 hover:text-gray-900 transition-colors"/>
      {!isLoading && unreadCount > 0 && (<badge_1.Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center text-xs p-0 min-w-[20px]">
          {unreadCount > 99 ? '99+' : unreadCount}
        </badge_1.Badge>)}
    </link_1.default>);
}
