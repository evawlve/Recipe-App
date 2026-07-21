import { DailySummaryCard } from './DailySummaryCard';
import { FoodCard } from './FoodCard';

// A stylized phone frame showing the mobile app's home tab: date header,
// daily summary card, and a logged meal with a real food card (including the
// official fatsecret attribution badge, exactly as it appears in-app).
export function PhoneMock() {
  return (
    <div className="mx-auto w-full max-w-[340px]">
      <div className="rounded-[44px] border-[6px] border-border-dark bg-background p-3 shadow-2xl">
        {/* Dynamic island */}
        <div className="mx-auto mb-3 h-6 w-28 rounded-full bg-surface" />

        {/* Date header */}
        <div className="flex items-center justify-between border-b border-border px-2 pb-2">
          <span className="text-lg font-black text-muted" aria-hidden="true">
            ‹
          </span>
          <p className="font-extrabold">Today</p>
          <span className="text-lg font-black text-muted" aria-hidden="true">
            ›
          </span>
        </div>

        <div className="space-y-3 px-1 pb-2 pt-3">
          <DailySummaryCard />

          <div className="flex items-center justify-between px-1 pt-1">
            <p className="font-extrabold">🥩 Dinner</p>
            <p className="text-sm font-bold text-muted">619 kcal</p>
          </div>

          <FoodCard
            name="Grilled Chicken Breast"
            serving="1 × 100g"
            kcal={165}
            protein={31}
            carbs={0}
            fat={4}
            confidence="exact"
            badge
          />

          <div className="chunky-btn chunky-btn-gray w-full py-2.5 text-sm normal-case tracking-normal">
            + Add Food
          </div>
        </div>
      </div>
    </div>
  );
}

export default PhoneMock;
