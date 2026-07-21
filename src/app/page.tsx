import { FATSECRET_BADGE_HTML } from '@/components/SiteFooter';

// Fully static marketing landing page. The web recipe app is parked (see git
// history) while the product focus is the mobile app; this page must never
// depend on the database or auth so it cannot break.
export const dynamic = 'force-static';

const FEATURES = [
  {
    title: 'Magic Log',
    body: 'Type "chicken breast and a banana" and it’s logged. Natural-language food logging that understands portions, brands, and servings.',
  },
  {
    title: 'Data you can trust',
    body: 'Nutrition sourced from fatsecret, USDA FoodData Central, and Open Food Facts — with per-item source attribution right in the app.',
  },
  {
    title: 'Coming soon',
    body: 'Barcode scanning, meal photos, recipes, and sharing. iOS first, Android next. Currently in private development.',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-4xl px-4">
      {/* Hero */}
      <section className="flex flex-col items-center text-center pt-20 pb-14">
        <img src="/logo.svg" alt="Mealspire" className="logo-dark-mode h-16 w-auto mb-6" />
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Mealspire</h1>
        <p className="mt-3 text-lg text-foreground/70 max-w-xl">
          Food tracking that keeps it real. Log meals in plain English, scan what you eat, and
          see nutrition you can actually trust.
        </p>
        <p className="mt-2 text-sm text-foreground/60">
          A mobile nutrition app, currently in development — coming soon to the App Store.
        </p>
        <div className="mt-6" dangerouslySetInnerHTML={{ __html: FATSECRET_BADGE_HTML }} />
      </section>

      {/* Features */}
      <section className="grid gap-4 sm:grid-cols-3 pb-20">
        {FEATURES.map((f) => (
          <div key={f.title} className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold text-lg">{f.title}</h2>
            <p className="mt-2 text-sm text-foreground/70 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
