"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WelcomeNotification() {
  const searchParams = useSearchParams();
  const [showNotification, setShowNotification] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
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

  if (!showNotification) return null;

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm">
      <Alert className="border-green-200 bg-green-50 text-green-800 shadow-lg">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertDescription className="flex items-center justify-between">
          <span className="flex-1">{message}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNotification(false)}
            className="ml-2 h-6 w-6 p-0 hover:bg-green-100"
          >
            <X className="h-3 w-3" />
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
