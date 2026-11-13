"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import AuthCard from '@/components/auth/AuthCard';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// The self-serve account-deletion card behind /account/delete — the web link
// Google Play's Data safety form asks for. (Apple 5.1.1(v) wants the in-app
// path; that is the mobile half and a later brief.) Three states:
//
//   signed-out → an explanation plus the existing AuthCard, mounted ON this
//                page so the sign-in lands back here;
//   signed-in  → the account's email, what the deletion covers, a typed-DELETE
//                confirmation, and the call to DELETE /api/account/delete;
//   done       → the request was ACCEPTED. Deliberately not "deleted": the
//                route answers success even when its Supabase Auth step fails
//                (it logs and falls through), so this client cannot prove the
//                auth account is gone and must not claim it.
//
// Auth state is read with the browser client's getUser(), never the server-side
// getCurrentUser() (it needs the database). The fetch → signOut sequence is the
// one SettingsPanel.handleDeleteAccount() used for the parked web app; its two
// confirm() dialogs are replaced by the typed confirmation.

export const DELETE_ACCOUNT_ENDPOINT = '/api/account/delete';
export const CONFIRM_WORD = 'DELETE';

/** What a successful request removes. Mirrors the privacy page's wording. */
export const DELETION_SCOPE = [
  'your account, profile and targets',
  'your food log and meals',
  'your saved meals, streaks and weigh-ins',
  'anything from the former web recipe app (recipes, comments, likes, collections)',
];

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; email: string }
  | { kind: 'done' }
  | { kind: 'unavailable'; message: string };

type AuthUser = { id: string; email?: string | null };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** The error text for a non-2xx response, shown verbatim. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      return (body as { error: string }).error;
    }
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
}

export default function DeleteAccountCard() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the request is accepted, the SIGNED_OUT event from our own signOut()
  // must not flip the card back to the sign-in state.
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch (err) {
      setPhase({ kind: 'unavailable', message: errorMessage(err) });
      return;
    }

    const apply = (user: AuthUser | null | undefined) => {
      if (cancelled || doneRef.current) return;
      if (user) {
        setPhase({ kind: 'signed-in', email: user.email ?? '' });
        return;
      }
      // Put this page in the URL before AuthCard mounts, so its post-sign-in
      // router.replace(redirectTo) lands back here rather than on the parked
      // web app's default. Next.js syncs useSearchParams with replaceState.
      if (typeof window !== 'undefined' && pathname) {
        const params = new URLSearchParams(window.location.search);
        if (!params.get('redirectTo')) {
          params.set('redirectTo', pathname);
          window.history.replaceState(window.history.state, '', `${pathname}?${params.toString()}`);
        }
      }
      setPhase({ kind: 'signed-out' });
    };

    supabase.auth
      .getUser()
      .then(({ data, error: userError }: { data: { user: AuthUser | null }; error: unknown }) => {
        if (userError) {
          // An expired or absent session reads as "not signed in", not as a fault.
          apply(null);
          return;
        }
        apply(data.user);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPhase({ kind: 'unavailable', message: errorMessage(err) });
      });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event: string, session: { user: AuthUser } | null) => {
        // INITIAL_SESSION is the cached session replayed on subscribe; getUser()
        // above is the server-validated answer, so only real transitions count.
        if (event === 'INITIAL_SESSION') return;
        apply(session?.user ?? null);
      }
    );

    return () => {
      cancelled = true;
      listener?.subscription?.unsubscribe?.();
    };
  }, [pathname]);

  async function handleDelete() {
    if (confirmText !== CONFIRM_WORD || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(DELETE_ACCOUNT_ENDPOINT, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        setError(await describeFailure(response));
        return;
      }
      doneRef.current = true;
      try {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
      } catch (signOutError) {
        // The request was accepted; a failed local sign-out does not undo that.
        console.warn('account.delete: sign-out after deletion failed', signOutError);
      }
      setPhase({ kind: 'done' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (phase.kind === 'loading') {
    return (
      <div className="chunky-card p-6 text-base font-semibold text-muted" role="status">
        Checking whether you are signed in…
      </div>
    );
  }

  if (phase.kind === 'unavailable') {
    return (
      <div className="chunky-card p-6" role="alert">
        <p className="text-base font-bold text-foreground">Account deletion is not available right now.</p>
        <p className="mt-2 text-sm font-semibold text-destructive">{phase.message}</p>
      </div>
    );
  }

  if (phase.kind === 'done') {
    return (
      <div className="chunky-card p-6" role="status">
        <h2 className="text-xl font-extrabold tracking-tight">Your deletion request was accepted</h2>
        <p className="mt-3 text-base font-semibold leading-relaxed text-muted">
          Once it has been processed, this account can no longer be signed into, and the data listed
          on this page is removed with it. You have been signed out on this device.
        </p>
        <p className="mt-3 text-base font-semibold leading-relaxed text-muted">
          If you can still sign in later, or you have any question about your data, write to the
          contact address on our <a href="/privacy" className="underline decoration-2 underline-offset-4">privacy policy</a>.
        </p>
      </div>
    );
  }

  if (phase.kind === 'signed-out') {
    return (
      <div className="flex flex-col items-center gap-6">
        <p className="max-w-md text-center text-base font-semibold leading-relaxed text-muted">
          Sign in with the account you want to delete. You will be asked to confirm before anything
          is removed.
        </p>
        <AuthCard title="Sign in to delete your account" mode="signin" />
      </div>
    );
  }

  const confirmed = confirmText === CONFIRM_WORD;

  return (
    <div className="chunky-card p-6 sm:p-8">
      <p className="text-base font-semibold text-muted">
        Signed in as{' '}
        <strong className="text-foreground" data-testid="account-email">
          {phase.email || 'this account'}
        </strong>
      </p>

      <h2 className="mt-4 text-xl font-extrabold tracking-tight">This permanently removes</h2>
      <ul className="mt-3 space-y-2">
        {DELETION_SCOPE.map((item) => (
          <li
            key={item}
            className="border-l-4 border-border pl-4 text-base font-semibold leading-relaxed text-muted"
          >
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm font-semibold leading-relaxed text-muted">
        This cannot be undone. Health data read from Apple Health is never stored on our servers,
        so there is nothing of it to delete here.
      </p>

      <div className="mt-6 space-y-2">
        <Label htmlFor="delete-confirm">
          Type <span className="font-mono font-bold">{CONFIRM_WORD}</span> to confirm
        </Label>
        <Input
          id="delete-confirm"
          autoComplete="off"
          spellCheck={false}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_WORD}
          disabled={busy}
          className="h-12 rounded-xl"
        />
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="destructive"
        onClick={handleDelete}
        disabled={!confirmed || busy}
        className="mt-6 h-12 w-full rounded-xl text-base font-extrabold"
      >
        {busy ? 'Deleting…' : 'Delete my account'}
      </Button>
    </div>
  );
}
