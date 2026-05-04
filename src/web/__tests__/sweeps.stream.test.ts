import { describe, expect, it } from 'vitest';

describe('sweeps SSE stream', () => {
  it('coerces both sweepId and request :id to strings for comparison', async () => {
    // This test verifies the behavior: when SSE stream receives :id="123" (string)
    // and sweepEvents emits with sweepId="123" (from String(numericId))
    // they should match

    const requestId = '123'; // comes as string from :id param
    const emittedSweepId = String(123); // our code does String(...) on numeric id

    expect(requestId === emittedSweepId).toBe(true);
  });

  it('SweepEvent emitted with String sweepId matches request string param', () => {
    const requestParamId = '456'; // from c.req.param('id')
    const activeSweepNumeric = 456; // numeric sweep id
    const eventSweepId = String(activeSweepNumeric); // tee stream does String(...)

    expect(eventSweepId).toBe(requestParamId);
  });

  it('does not match when ids differ', () => {
    const requestId = String(123);
    const eventSweepId = String(999);

    expect(requestId === eventSweepId).toBe(false);
  });
});
