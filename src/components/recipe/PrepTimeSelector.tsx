import { Clock } from "lucide-react";

const PREP_TIME_OPTIONS = [
  "<15 min",
  "15-30 min",
  "30-45 min",
  "45min - 1hr",
  "1hr+",
] as const;

export type PrepTime = typeof PREP_TIME_OPTIONS[number];

interface PrepTimeSelectorProps {
  value?: PrepTime;
  onChange: (value: PrepTime) => void;
  error?: string;
}

export function PrepTimeSelector({ value, onChange, error }: PrepTimeSelectorProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-text mb-2 flex items-center gap-2">
        <Clock className="h-4 w-4" />
        Prep Time
      </label>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {PREP_TIME_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`
              px-3 py-2 rounded-lg text-sm font-medium transition-all
              ${value === option
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-card text-muted-foreground border border-border hover:border-primary hover:text-text"
              }
              ${error ? "border-destructive" : ""}
            `}
          >
            {option}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-sm text-destructive mt-1">{error}</p>
      )}
    </div>
  );
}

