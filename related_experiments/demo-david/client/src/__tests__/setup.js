import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';

// Recent Node versions define their own experimental localStorage global, which
// is missing or empty under jsdom. Every test gets a fresh in-memory one instead.
function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); },
    clear: () => { data.clear(); },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});
