import type { Metadata } from 'next';
import { Suspense } from 'react';
import DeleteAccountCard from '@/components/account/DeleteAccountCard';

// Self-serve account deletion — the web link Google Play's Data safety form
// requires for an app with account creation (the in-app path Apple 5.1.1(v)
// wants is the mobile half, built separately). Like /privacy, the server half
// of this page depends on nothing: no database, no auth. All of that happens in
// the client card, which reads the session with the Supabase browser client and
// calls DELETE /api/account/delete. The route is what needs DATABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY, so on a deployment that cannot reach the database
// this page renders and the call answers 401 or 503 — see the report.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Delete your account — Kinda Healthy',
  description:
    'Delete your Kinda Healthy account and the data stored with it: your profile and targets, food log, meals, saved meals, streaks and weigh-ins.',
};

export default function DeleteAccountPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Delete your account</h1>
      <p className="mt-3 text-base font-bold text-muted">Kinda Healthy</p>

      <p className="mt-6 text-lg font-semibold leading-relaxed text-muted">
        You can delete your Kinda Healthy account yourself, here. Deleting it removes your account,
        profile and targets, your food log and meals, your saved meals, streaks and weigh-ins, and
        anything left from the former web recipe app. This cannot be undone.
      </p>
      <p className="mt-4 text-base font-semibold leading-relaxed text-muted">
        If you would rather we do it, or you cannot sign in, the{' '}
        <a href="/privacy" className="underline decoration-2 underline-offset-4">
          privacy policy
        </a>{' '}
        has the contact address for a deletion request by email.
      </p>

      <div className="mt-10">
        {/* The card mounts AuthCard, which calls useSearchParams(); a static page
            needs the Suspense boundary or `next build` refuses to prerender it. */}
        <Suspense
          fallback={
            <div className="chunky-card p-6 text-base font-semibold text-muted" role="status">
              Loading…
            </div>
          }
        >
          <DeleteAccountCard />
        </Suspense>
      </div>
    </div>
  );
}
