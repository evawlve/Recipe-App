"use client";

import { cn } from "@/lib/utils";

interface TabNavProps {
  tab: "saved" | "uploaded" | "followers" | "following" | "settings";
  onTabChange: (tab: "saved" | "uploaded" | "followers" | "following" | "settings") => void;
}

export default function TabNav({ tab, onTabChange }: TabNavProps) {
  const tabs = [
    { id: "saved" as const, label: "Saved" },
    { id: "uploaded" as const, label: "Uploaded" },
    { id: "followers" as const, label: "Followers" },
    { id: "following" as const, label: "Following" },
    { id: "settings" as const, label: "Settings" },
  ];

  return (
    <div className="border-b border-border">
      <nav className="flex space-x-8">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              "py-4 px-1 text-sm font-medium border-b-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              tab === id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
