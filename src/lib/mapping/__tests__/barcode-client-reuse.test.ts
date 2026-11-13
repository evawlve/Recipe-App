jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  FATSECRET_ENABLED: true,
  FATSECRET_CLIENT_ID: 'test-id',
  FATSECRET_CLIENT_SECRET: 'test-secret',
}));

import { FatSecretClient } from '../client';
import { lookupFatSecretBarcode, __setFatSecretBarcodeClientForTests } from '../barcode';

const OAUTH = 'https://oauth.fatsecret.com/';

function makeStub() {
  return jest.fn(async (url: unknown) => {
    if (String(url).startsWith(OAUTH)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 't', token_type: 'Bearer', expires_in: 86400 }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

const oauthCalls = (f: jest.Mock) => f.mock.calls.filter((c) => String(c[0]).startsWith(OAUTH)).length;

describe('lookupFatSecretBarcode client reuse', () => {
  const originalFetch = global.fetch;
  let fetchStub: jest.Mock;

  beforeEach(() => {
    __setFatSecretBarcodeClientForTests(undefined);
    fetchStub = makeStub();
    global.fetch = fetchStub as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    __setFatSecretBarcodeClientForTests(undefined);
  });

  it('fetches the OAuth token once across two scans, and again after a reset', async () => {
    // Sequential on purpose: a burst of first scans can each fetch a token (harmless).
    await lookupFatSecretBarcode('0038000138416');
    await lookupFatSecretBarcode('0038000138416');
    expect(oauthCalls(fetchStub)).toBe(1);

    __setFatSecretBarcodeClientForTests(undefined);
    await lookupFatSecretBarcode('0038000138416');
    expect(oauthCalls(fetchStub)).toBe(2);
  });

  it('uses an explicit opts.client and does not construct the singleton', async () => {
    const explicitStub = makeStub();
    const client = new FatSecretClient({
      clientId: 'x',
      clientSecret: 'y',
      fetchImpl: explicitStub as unknown as typeof fetch,
    });
    await lookupFatSecretBarcode('0038000138416', { client });
    expect(oauthCalls(explicitStub)).toBe(1);
    expect(fetchStub).toHaveBeenCalledTimes(0);
  });
});
