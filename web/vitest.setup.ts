import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

// Browse filters persist to sessionStorage (survive page switches in a
// session); clear it between tests so each starts from defaults.
beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // no-op if sessionStorage is unavailable
  }
});
