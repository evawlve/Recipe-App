"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TabNav;
const navigation_1 = require("next/navigation");
const utils_1 = require("@/lib/utils");
function TabNav({ tab }) {
    const router = (0, navigation_1.useRouter)();
    const searchParams = (0, navigation_1.useSearchParams)();
    const handleTabChange = (newTab) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", newTab);
        router.push(`/me?${params.toString()}`);
    };
    const tabs = [
        { id: "saved", label: "Saved" },
        { id: "uploaded", label: "Uploaded" },
        { id: "settings", label: "Settings" },
    ];
    return (<div className="border-b border-border">
      <nav className="flex space-x-8">
        {tabs.map(({ id, label }) => (<button key={id} onClick={() => handleTabChange(id)} className={(0, utils_1.cn)("py-4 px-1 text-sm font-medium border-b-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", tab === id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground")}>
            {label}
          </button>))}
      </nav>
    </div>);
}
