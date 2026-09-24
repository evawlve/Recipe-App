/**
 * parse-rate-limit.ts — the in-flight cap, the reservation-error breaker and the P2028
 * test (review H2). The module's existing tests (limits, isFreeParseRequest) live in
 * parse-rate-limit.test.ts and are untouched.
 */
import {
  MAX_INFLIGHT_PER_USER,
  acquireInflight,
  releaseInflight,
  inflightCount,
  RESERVATION_FAILURES_BEFORE_FAIL_CLOSED,
  recordReservationFailure,
  recordReservationSuccess,
  reservationFailsClosed,
  isReservationTimeout,
  _resetInflightForTests,
} from './parse-rate-limit';

beforeEach(() => _resetInflightForTests());

describe('in-flight cap', () => {
  test('is 2 per user', () => {
    expect(MAX_INFLIGHT_PER_USER).toBe(2);
  });

  test('N acquires succeed, N+1 fails and takes nothing', () => {
    expect(acquireInflight('u')).toBe(true);
    expect(acquireInflight('u')).toBe(true);
    expect(acquireInflight('u')).toBe(false);
    expect(inflightCount('u')).toBe(2);
  });

  test('per user: one user at the cap does not block another', () => {
    acquireInflight('u');
    acquireInflight('u');
    expect(acquireInflight('v')).toBe(true);
  });

  test('a release frees exactly one slot', () => {
    acquireInflight('u');
    acquireInflight('u');
    releaseInflight('u');
    expect(inflightCount('u')).toBe(1);
    expect(acquireInflight('u')).toBe(true);
    expect(acquireInflight('u')).toBe(false);
  });

  test('a release never goes below zero, so a double release cannot mint a slot', () => {
    acquireInflight('u');
    releaseInflight('u');
    releaseInflight('u');
    expect(inflightCount('u')).toBe(0);
    expect(acquireInflight('u')).toBe(true);
    expect(acquireInflight('u')).toBe(true);
    expect(acquireInflight('u')).toBe(false);
  });

  test('_resetInflightForTests() clears every user', () => {
    acquireInflight('u');
    acquireInflight('u');
    _resetInflightForTests();
    expect(inflightCount('u')).toBe(0);
  });
});

describe('reservation-error breaker', () => {
  test('three consecutive errors fail open; the fourth fails closed', () => {
    expect(RESERVATION_FAILURES_BEFORE_FAIL_CLOSED).toBe(3);
    expect(reservationFailsClosed(recordReservationFailure())).toBe(false);
    expect(reservationFailsClosed(recordReservationFailure())).toBe(false);
    expect(reservationFailsClosed(recordReservationFailure())).toBe(false);
    expect(reservationFailsClosed(recordReservationFailure())).toBe(true);
  });

  test('a success resets the run', () => {
    recordReservationFailure();
    recordReservationFailure();
    recordReservationFailure();
    recordReservationSuccess();
    expect(recordReservationFailure()).toBe(1);
  });
});

describe('isReservationTimeout', () => {
  test('P2028 only', () => {
    expect(isReservationTimeout({ code: 'P2028' })).toBe(true);
    expect(isReservationTimeout(Object.assign(new Error('x'), { code: 'P2028' }))).toBe(true);
    expect(isReservationTimeout({ code: 'P2002' })).toBe(false);
    expect(isReservationTimeout(new Error('db down'))).toBe(false);
    expect(isReservationTimeout(null)).toBe(false);
    expect(isReservationTimeout('P2028')).toBe(false);
  });
});
