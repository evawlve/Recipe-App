"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WelcomeNotification = WelcomeNotification;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const alert_1 = require("@/components/ui/alert");
const lucide_react_1 = require("lucide-react");
const button_1 = require("@/components/ui/button");
function WelcomeNotification() {
    const searchParams = (0, navigation_1.useSearchParams)();
    const [showNotification, setShowNotification] = (0, react_1.useState)(false);
    const [message, setMessage] = (0, react_1.useState)("");
    (0, react_1.useEffect)(() => {
        const welcome = searchParams.get("welcome");
        const messageParam = searchParams.get("message");
        if (welcome === "true" && messageParam) {
            setMessage(decodeURIComponent(messageParam));
            setShowNotification(true);
            // Auto-hide after 8 seconds
            const timer = setTimeout(() => {
                setShowNotification(false);
            }, 8000);
            return () => clearTimeout(timer);
        }
    }, [searchParams]);
    if (!showNotification)
        return null;
    return (<div className="fixed top-4 right-4 z-50 max-w-sm">
      <alert_1.Alert className="border-green-200 bg-green-50 text-green-800 shadow-lg">
        <lucide_react_1.CheckCircle className="h-4 w-4 text-green-600"/>
        <alert_1.AlertDescription className="flex items-center justify-between">
          <span className="flex-1">{message}</span>
          <button_1.Button variant="ghost" size="sm" onClick={() => setShowNotification(false)} className="ml-2 h-6 w-6 p-0 hover:bg-green-100">
            <lucide_react_1.X className="h-3 w-3"/>
          </button_1.Button>
        </alert_1.AlertDescription>
      </alert_1.Alert>
    </div>);
}
