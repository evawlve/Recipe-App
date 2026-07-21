import { FatsecretBadge } from '@/components/FatsecretBadge';
import { PhoneMock } from '@/components/landing/PhoneMock';
import { FoodCard } from '@/components/landing/FoodCard';

// Fully static marketing landing page styled after the mobile app's chunky
// Duolingo-like design system (see src/styles/tokens.css). The web recipe app
// is parked (see git history) while the product focus is the mobile app; this
// page must never depend on the database or auth so it cannot break.
export const dynamic = 'force-static';

const FEATURES = [
  {
    emoji: '🪄',
    tint: 'bg-tint-green',
    title: 'Magic Log',
    body: 'Type what you ate in plain English. Portions, brands, and servings are parsed and logged in seconds.',
  },
  {
    emoji: '🔎',
    tint: 'bg-tint-blue',
    title: 'Data you can trust',
    body: 'Nutrition sourced from fatsecret, USDA FoodData Central, and Open Food Facts — with per-item source attribution right on the card.',
  },
  {
    emoji: '📱',
    tint: 'bg-tint-orange',
    title: 'Coming soon',
    body: 'Barcode scanning, meal photos, recipes, and sharing. iOS first, Android next. Currently in private development.',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4">
      {/* Hero */}
      <section className="grid items-center gap-12 pb-16 pt-16 lg:grid-cols-2">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <img src="/logo.svg" alt="Mealspire" className="logo-dark-mode mb-6 h-14 w-auto" />
          <h1 className="text-5xl font-black tracking-tight sm:text-6xl">Mealspire</h1>
          <p className="mt-4 max-w-xl text-xl font-bold text-muted">
            Food tracking that keeps it real.
          </p>
          <p className="mt-2 max-w-xl text-base font-semibold text-muted">
            Log meals in plain English, scan what you eat, and see nutrition you can actually
            trust — coming soon to the App Store.
          </p>
          <a href="#magic-log" className="chunky-btn mt-8">
            See the magic
          </a>
          <FatsecretBadge height={24} className="mt-8" />
        </div>
        <PhoneMock />
      </section>

      {/* Magic Log demo */}
      <section id="magic-log" className="pb-16 text-center">
        <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
          Just type it. <span aria-hidden="true">✨</span>
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-base font-semibold text-muted">
          No database spelunking, no serving-size math. Magic Log turns a sentence into logged
          food — real records, real labels, real macros.
        </p>

        <div className="mx-auto mt-8 max-w-md">
          {/* Input mock */}
          <div className="chunky-card flex items-center gap-3 p-3.5">
            <span className="text-lg" aria-hidden="true">
              ✨
            </span>
            <p className="flex-1 truncate text-left font-bold text-muted">
              grilled chicken breast and a banana
            </p>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-primary-depth bg-primary text-base font-black text-white">
              ↑
            </span>
          </div>

          <p className="my-4 text-2xl font-black text-muted" aria-hidden="true">
            ↓
          </p>

          <div className="space-y-4">
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
            <FoodCard
              name="Banana"
              serving="1 × medium (118g)"
              kcal={105}
              protein={1}
              carbs={27}
              fat={0}
              confidence="exact"
              badge
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="grid gap-5 pb-16 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="chunky-card p-6">
            <span
              className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${f.tint}`}
              aria-hidden="true"
            >
              {f.emoji}
            </span>
            <h3 className="mt-4 text-lg font-extrabold">{f.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="pb-20">
        <div className="chunky-card-primary px-6 py-10 text-center">
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
            Coming soon to the App Store
          </h2>
          <p className="mx-auto mt-3 max-w-md text-base font-semibold text-muted">
            Mealspire is in private development. iOS first, Android next — follow along as the
            kitchen heats up. <span aria-hidden="true">🔥</span>
          </p>
        </div>
      </section>
    </div>
  );
}
