/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeleteAccountCard, { CONFIRM_WORD, DELETE_ACCOUNT_ENDPOINT } from './DeleteAccountCard';

// The card's three states — signed out, signed in, done — plus the error path,
// with fetch, next/navigation, the Supabase browser client and AuthCard mocked.
// AuthCard is stubbed because its real body pulls react-hook-form, zod and the
// Logo; what matters here is that it is mounted on THIS page, in signin mode,
// after the page has put itself in the URL as redirectTo.

const PAGE_PATH = '/account/delete';

const navigation = {
  replace: jest.fn(),
  push: jest.fn(),
};

jest.mock('next/navigation', () => ({
  usePathname: () => PAGE_PATH,
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock('@/components/auth/AuthCard', () => ({
  __esModule: true,
  default: ({ title, mode }: { title: string; mode: string }) => (
    <div data-testid="auth-card" data-mode={mode}>
      {title}
    </div>
  ),
}));

type AuthUser = { id: string; email?: string | null };
type AuthListener = (event: string, session: { user: AuthUser } | null) => void;

const supabaseMock = {
  user: null as AuthUser | null,
  listeners: [] as AuthListener[],
  signOut: jest.fn(async () => ({ error: null })),
  getUser: jest.fn(),
  unsubscribe: jest.fn(),
};

jest.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getUser: supabaseMock.getUser,
      signOut: supabaseMock.signOut,
      onAuthStateChange: (listener: AuthListener) => {
        supabaseMock.listeners.push(listener);
        return { data: { subscription: { unsubscribe: supabaseMock.unsubscribe } } };
      },
    },
  }),
}));

const SIGNED_IN_USER: AuthUser = { id: 'user-1', email: 'throwaway@example.com' };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  supabaseMock.user = null;
  supabaseMock.listeners = [];
  supabaseMock.signOut.mockClear();
  supabaseMock.unsubscribe.mockClear();
  supabaseMock.getUser.mockImplementation(async () => ({
    data: { user: supabaseMock.user },
    error: null,
  }));
  navigation.replace.mockClear();
  navigation.push.mockClear();
  global.fetch = jest.fn() as unknown as typeof fetch;
  window.history.replaceState(null, '', PAGE_PATH);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function typeConfirmation(text: string) {
  const input = screen.getByLabelText(new RegExp(`Type\\s*${CONFIRM_WORD}\\s*to confirm`, 'i'));
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
}

describe('DeleteAccountCard — signed out', () => {
  it('mounts AuthCard in signin mode and puts the page in the URL as redirectTo first', async () => {
    render(<DeleteAccountCard />);

    const card = await screen.findByTestId('auth-card');
    expect(card).toHaveAttribute('data-mode', 'signin');
    expect(screen.getByText(/Sign in with the account you want to delete/)).toBeInTheDocument();

    const params = new URLSearchParams(window.location.search);
    expect(params.get('redirectTo')).toBe(PAGE_PATH);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delete my account/)).toBeNull();
  });

  it('keeps an existing redirectTo rather than overwriting it', async () => {
    window.history.replaceState(null, '', `${PAGE_PATH}?redirectTo=%2Felsewhere`);
    render(<DeleteAccountCard />);
    await screen.findByTestId('auth-card');
    expect(new URLSearchParams(window.location.search).get('redirectTo')).toBe('/elsewhere');
  });

  it('switches to the signed-in state when the browser client reports a sign-in', async () => {
    render(<DeleteAccountCard />);
    await screen.findByTestId('auth-card');

    await act(async () => {
      supabaseMock.listeners.forEach((listener) => listener('SIGNED_IN', { user: SIGNED_IN_USER }));
    });

    expect(await screen.findByTestId('account-email')).toHaveTextContent(SIGNED_IN_USER.email!);
    expect(screen.queryByTestId('auth-card')).toBeNull();
  });
});

describe('DeleteAccountCard — signed in', () => {
  beforeEach(() => {
    supabaseMock.user = SIGNED_IN_USER;
  });

  it('shows the email and the deletion scope, and holds the button until DELETE is typed', async () => {
    render(<DeleteAccountCard />);

    expect(await screen.findByTestId('account-email')).toHaveTextContent('throwaway@example.com');
    expect(screen.getByText('your account, profile and targets')).toBeInTheDocument();
    expect(screen.getByText('your food log and meals')).toBeInTheDocument();
    expect(screen.getByText('your saved meals, streaks and weigh-ins')).toBeInTheDocument();
    expect(
      screen.getByText('anything from the former web recipe app (recipes, comments, likes, collections)')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('auth-card')).toBeNull();

    const button = screen.getByRole('button', { name: /Delete my account/ });
    expect(button).toBeDisabled();

    await typeConfirmation('delete');
    expect(button).toBeDisabled();

    await typeConfirmation(CONFIRM_WORD);
    expect(button).toBeEnabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls DELETE on the route with the session, signs out, and shows the accepted copy', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { success: true }));
    render(<DeleteAccountCard />);
    await screen.findByTestId('account-email');
    await typeConfirmation(CONFIRM_WORD);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DELETE_ACCOUNT_ENDPOINT);
    expect(init.method).toBe('DELETE');
    // Same-origin by default: the Supabase cookies ride along for getCurrentUser().
    expect(init.credentials ?? 'same-origin').toBe('same-origin');

    expect(supabaseMock.signOut).toHaveBeenCalledTimes(1);

    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent(/deletion request was accepted/i);
    expect(done).toHaveTextContent(/can no longer be signed into/i);
    // The route's success does not prove the auth deletion ran — never over-claim.
    expect(done).not.toHaveTextContent(/everything has been deleted/i);
    expect(screen.queryByRole('button', { name: /Delete my account/ })).toBeNull();
  });

  it('stays in the done state when our own sign-out fires SIGNED_OUT', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { success: true }));
    render(<DeleteAccountCard />);
    await screen.findByTestId('account-email');
    await typeConfirmation(CONFIRM_WORD);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    });
    await screen.findByRole('status');

    await act(async () => {
      supabaseMock.listeners.forEach((listener) => listener('SIGNED_OUT', null));
    });

    expect(screen.getByRole('status')).toHaveTextContent(/deletion request was accepted/i);
    expect(screen.queryByTestId('auth-card')).toBeNull();
  });

  it('shows the route error verbatim and stays signed in', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
    render(<DeleteAccountCard />);
    await screen.findByTestId('account-email');
    await typeConfirmation(CONFIRM_WORD);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized');
    expect(supabaseMock.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('account-email')).toBeInTheDocument();
    expect(screen.queryByText(/deletion request was accepted/i)).toBeNull();
  });

  it('shows a non-JSON failure as its status line', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    render(<DeleteAccountCard />);
    await screen.findByTestId('account-email');
    await typeConfirmation(CONFIRM_WORD);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503 Service Unavailable');
  });

  it('shows a network error verbatim', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<DeleteAccountCard />);
    await screen.findByTestId('account-email');
    await typeConfirmation(CONFIRM_WORD);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch');
    await waitFor(() => expect(screen.getByRole('button', { name: /Delete my account/ })).toBeEnabled());
  });
});
