"use client";

import { useMemo } from "react";
import { validatePassword, getPasswordStrengthLabel, getPasswordStrengthColor } from "@/lib/auth/password-validation";

interface PasswordStrengthIndicatorProps {
  password: string;
  userInputs?: string[];
  showRequirements?: boolean;
}

export default function PasswordStrengthIndicator({ 
  password, 
  userInputs = [], 
  showRequirements = true 
}: PasswordStrengthIndicatorProps) {
  const strength = useMemo(() => {
    if (!password) return null;
    return validatePassword(password, userInputs);
  }, [password, userInputs]);

  if (!password || !strength) {
    return null;
  }

  const strengthColor = getPasswordStrengthColor(strength.score);
  const strengthLabel = getPasswordStrengthLabel(strength.score);
  const widthPercentage = ((strength.score + 1) / 5) * 100;

  return (
    <div className="space-y-2 mt-2">
      {/* Strength Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Password strength:</span>
          <span 
            className="font-medium"
            style={{ color: strengthColor }}
          >
            {strengthLabel}
          </span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-300 ease-in-out rounded-full"
            style={{
              width: `${widthPercentage}%`,
              backgroundColor: strengthColor,
            }}
          />
        </div>
      </div>

      {/* Requirements List */}
      {showRequirements && strength.feedback.suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Requirements:</p>
          <ul className="space-y-0.5">
            {strength.feedback.suggestions.map((suggestion, index) => (
              <li key={index} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-orange-500 mt-0.5">•</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warning */}
      {strength.feedback.warning && (
        <p className="text-xs text-orange-600 dark:text-orange-400">
          ⚠️ {strength.feedback.warning}
        </p>
      )}

      {/* Crack Time Display (for strong passwords) */}
      {strength.isValid && (
        <p className="text-xs text-green-600 dark:text-green-400">
          ✓ Estimated crack time: {strength.crackTime}
        </p>
      )}
    </div>
  );
}

