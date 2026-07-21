import { FatsecretBadge } from '@/components/FatsecretBadge';

// Static replica of the mobile app's logged-food card
// (KindaHealthyMobile src/components/food-log/food-item-card.tsx):
// name → serving line → confidence chip (+ fatsecret badge), calories on the
// right at weight 900, and the colored P/C/F macro line under a divider.

const CONFIDENCE = {
  exact: { label: 'Exact Match', icon: '✓', color: '#58CC02' },
  good: { label: 'Good Estimate', icon: '≈', color: '#FF9600' },
  ai: { label: 'AI Estimated', icon: '?', color: '#EA2B2B' },
} as const;

export type FoodCardProps = {
  name: string;
  serving: string;
  brand?: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence?: keyof typeof CONFIDENCE;
  /** Show the official fatsecret badge under the serving line. */
  badge?: boolean;
};

export function FoodCard({
  name,
  serving,
  brand,
  kcal,
  protein,
  carbs,
  fat,
  confidence = 'exact',
  badge = false,
}: FoodCardProps) {
  const conf = CONFIDENCE[confidence];
  return (
    <div className="chunky-card p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold leading-tight">{name}</p>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-muted">
            {serving}
            {brand ? ` • ${brand}` : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{
                color: conf.color,
                border: `1.5px solid ${conf.color}`,
                backgroundColor: `${conf.color}18`,
              }}
            >
              {conf.icon} {conf.label}
            </span>
          </div>
          {badge ? <FatsecretBadge height={16} className="mt-1.5" /> : null}
        </div>
        <div className="shrink-0 text-center">
          <p className="text-[22px] font-black leading-none">{kcal}</p>
          <p className="text-[11px] font-bold text-muted">kcal</p>
        </div>
      </div>
      <div className="mt-2.5 border-t border-border pt-2 text-xs font-semibold text-muted">
        P: <span className="font-bold text-macro-protein">{protein}g</span>
        <span className="mx-1.5">•</span>
        C: <span className="font-bold text-macro-carbs">{carbs}g</span>
        <span className="mx-1.5">•</span>
        F: <span className="font-bold text-macro-fat">{fat}g</span>
      </div>
    </div>
  );
}

export default FoodCard;
