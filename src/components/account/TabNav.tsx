"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

interface TabNavProps {
  tab: "saved" | "uploaded" | "settings";
}

export default function TabNav({ tab }: TabNavProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (newTab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", newTab);
    router.push(`/me?${params.toString()}`);
  };

  const tabs = [
    { id: "saved", label: "Saved" },
    { id: "uploaded", label: "Uploaded" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="border-b border-border">
      <nav className="flex space-x-8">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => handleTabChange(id)}
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
