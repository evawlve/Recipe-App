import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kinda Healthy Resolution API',
  description: 'Stateless NLP, food search, barcode, and serving resolution engine.',
};

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased selection:bg-teal-500 selection:text-neutral-950">
      {/* Header */}
      <header className="border-b border-neutral-900 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center font-bold text-neutral-950 shadow-lg shadow-teal-500/20">
              KH
            </div>
            <span className="font-semibold text-lg tracking-tight">Kinda Healthy API</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-sm font-medium text-emerald-400">All Systems Operational</span>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-16 space-y-16">
        <section className="space-y-6 max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-teal-400 via-emerald-400 to-teal-300 bg-clip-text text-transparent">
            Stateless Portion & Portability Engine
          </h1>
          <p className="text-neutral-400 text-lg leading-relaxed">
            The core resolution engine for the Kinda Healthy mobile app. Fully decoupled, stateless, and powered by cached FatSecret, USDA FDC, OpenFoodFacts, and portion estimation models.
          </p>
        </section>

        {/* API Routes Docs */}
        <section className="space-y-8">
          <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
            <h2 className="text-xl font-semibold tracking-tight">Active API Contracts</h2>
            <span className="text-xs text-neutral-500 uppercase tracking-widest font-mono">v1.2.0</span>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Route 1 */}
            <div className="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-900 hover:border-neutral-800 transition duration-300 space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 text-xs font-bold font-mono rounded bg-teal-500/10 text-teal-400 uppercase">POST</span>
                <code className="text-neutral-200 font-mono text-sm">/api/nlp/parse</code>
              </div>
              <p className="text-sm text-neutral-400">
                Resolves unstructured natural language food entries into raw food structures with scaled macronutrients, grams, and available servings.
              </p>
            </div>

            {/* Route 2 */}
            <div className="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-900 hover:border-neutral-800 transition duration-300 space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 text-xs font-bold font-mono rounded bg-emerald-500/10 text-emerald-400 uppercase">GET</span>
                <code className="text-neutral-200 font-mono text-sm">/api/foods/search</code>
              </div>
              <p className="text-sm text-neutral-400">
                Searches cache food templates and cached items from FatSecret and USDA. Returns a ranked list with type-tagged serving options.
              </p>
            </div>

            {/* Route 3 */}
            <div className="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-900 hover:border-neutral-800 transition duration-300 space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 text-xs font-bold font-mono rounded bg-emerald-500/10 text-emerald-400 uppercase">GET</span>
                <code className="text-neutral-200 font-mono text-sm">/api/foods/barcode</code>
              </div>
              <p className="text-sm text-neutral-400">
                Looks up barcodes across cached OpenFoodFacts and FatSecret. Automatically triggers cache hydration and returns rich macro and serving metadata.
              </p>
            </div>

            {/* Route 4 */}
            <div className="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-900 hover:border-neutral-800 transition duration-300 space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 text-xs font-bold font-mono rounded bg-emerald-500/10 text-emerald-400 uppercase">GET</span>
                <code className="text-neutral-200 font-mono text-sm">/api/foods/:foodId/serving</code>
              </div>
              <p className="text-sm text-neutral-400">
                Estimates custom portion weights (e.g. tablespoons, scoops) using density and category-aware portion backfills.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-900 bg-neutral-950 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-neutral-600">
          &copy; {new Date().getFullYear()} Kinda Healthy. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

