// Static replica of the mobile app's daily summary card
// (KindaHealthyMobile src/components/food-log/daily-summary-card.tsx):
// green chunky card, calorie progress ring with "kcal left" center, consumed/
// target stats, and glossy macro progress bars in the app's macro colors.

const TARGET = 2200;
const CONSUMED = 1390;
const REMAINING = TARGET - CONSUMED;

const RING_SIZE = 110;
const RING_STROKE = 12;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;
const RING_OFFSET = RING_C * (1 - CONSUMED / TARGET);

const MACROS = [
  { emoji: '🍗', label: 'Protein', eaten: 96, goal: 140, color: 'hsl(var(--macro-protein))' },
  { emoji: '🍚', label: 'Carbs', eaten: 180, goal: 220, color: 'hsl(var(--macro-carbs))' },
  { emoji: '🥑', label: 'Fat', eaten: 48, goal: 70, color: 'hsl(var(--macro-fat))' },
];

export function DailySummaryCard() {
  return (
    <div className="chunky-card-primary p-4 text-left">
      <p className="text-lg font-extrabold">Today&rsquo;s Summary</p>

      <div className="mt-3 flex items-center justify-center gap-6">
        {/* Calorie ring */}
        <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke="hsl(var(--track))"
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_OFFSET}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-2xl font-black leading-none">{REMAINING}</p>
              <p className="mt-0.5 text-[11px] font-bold text-muted">kcal left</p>
            </div>
          </div>
        </div>

        {/* Consumed / Target stats */}
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-lg font-extrabold leading-tight">{CONSUMED.toLocaleString('en-US')}</p>
            <p className="text-xs font-semibold text-muted">Consumed</p>
          </div>
          <div className="h-14 w-px bg-border" />
          <div className="text-center">
            <p className="text-lg font-extrabold leading-tight">{TARGET.toLocaleString('en-US')}</p>
            <p className="text-xs font-semibold text-muted">Target</p>
          </div>
        </div>
      </div>

      {/* Macro bars */}
      <div className="mt-4 space-y-3.5 border-t border-border pt-3">
        {MACROS.map((m) => (
          <div key={m.label}>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-bold">
                {m.emoji} {m.label}
              </p>
              <p className="text-xs font-semibold text-muted">
                {m.eaten}g / {m.goal}g
              </p>
            </div>
            <div className="chunky-bar">
              <div
                className="chunky-bar-fill"
                style={{
                  width: `${Math.round((m.eaten / m.goal) * 100)}%`,
                  backgroundColor: m.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DailySummaryCard;
