import { describe, expect, it } from 'vitest';

import { log } from '../log.js';

describe('log', () => {
  it('exposes a configured pino logger', () => {
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('binds the service name on every record', () => {
    expect(log.bindings()).toMatchObject({ service: 'house-track' });
  });
});
