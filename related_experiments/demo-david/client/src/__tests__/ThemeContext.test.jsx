import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeContext';
import ThemeToggle from '../components/ThemeToggle';

// jsdom has no matchMedia. This stand-in reports the chosen system setting and
// lets a test flip it, like changing the operating system theme.
function mockSystemTheme(initialDark) {
  let listeners = [];
  const query = {
    matches: initialDark,
    addEventListener: (_type, fn) => { listeners.push(fn); },
    removeEventListener: (_type, fn) => { listeners = listeners.filter(l => l !== fn); },
  };
  window.matchMedia = vi.fn(() => query);
  return {
    set(dark) {
      query.matches = dark;
      act(() => listeners.forEach(fn => fn({ matches: dark })));
    },
  };
}

function renderToggle() {
  return render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
}

const isDarkPage = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.matchMedia;
});

test('with nothing saved it follows the system setting: light', () => {
  mockSystemTheme(false);
  renderToggle();
  expect(isDarkPage()).toBe(false);
  expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
});

test('with nothing saved it follows the system setting: dark', () => {
  mockSystemTheme(true);
  renderToggle();
  expect(isDarkPage()).toBe(true);
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
});

test('does not write anything to storage until the visitor chooses', () => {
  mockSystemTheme(true);
  renderToggle();
  expect(localStorage.getItem('theme')).toBeNull();
});

test('the toggle switches the page theme both ways and remembers the choice', async () => {
  mockSystemTheme(false);
  renderToggle();

  await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
  expect(isDarkPage()).toBe(true);
  expect(localStorage.getItem('theme')).toBe('dark');
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
  expect(isDarkPage()).toBe(false);
  expect(localStorage.getItem('theme')).toBe('light');
});

test('a saved choice wins over the system setting', () => {
  localStorage.setItem('theme', 'light');
  mockSystemTheme(true);
  renderToggle();
  expect(isDarkPage()).toBe(false);

  localStorage.setItem('theme', 'dark');
  mockSystemTheme(false);
  renderToggle();
  expect(isDarkPage()).toBe(true);
});

test('an unknown saved value is ignored', () => {
  localStorage.setItem('theme', 'purple');
  mockSystemTheme(true);
  renderToggle();
  expect(isDarkPage()).toBe(true);
});

test('without a saved choice it follows a change of the system setting', () => {
  const system = mockSystemTheme(false);
  renderToggle();
  system.set(true);
  expect(isDarkPage()).toBe(true);
  system.set(false);
  expect(isDarkPage()).toBe(false);
});

test('after a choice the system setting no longer changes the page', async () => {
  const system = mockSystemTheme(false);
  renderToggle();
  await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
  system.set(false);
  system.set(true);
  system.set(false);
  expect(isDarkPage()).toBe(true);
});

test('stops listening to the system setting when it unmounts', () => {
  const system = mockSystemTheme(false);
  const { unmount } = renderToggle();
  const query = window.matchMedia.mock.results[0].value;
  const remove = vi.spyOn(query, 'removeEventListener');
  unmount();
  expect(remove).toHaveBeenCalled();
  system.set(true);
});

test('works when storage is blocked and when matchMedia is missing', async () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  renderToggle();
  expect(isDarkPage()).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
  expect(isDarkPage()).toBe(true);
});

test('useTheme gives the state and toggle to any child', async () => {
  mockSystemTheme(false);
  function Probe() {
    const { dark, toggle } = useTheme();
    return <button onClick={toggle}>{dark ? 'is dark' : 'is light'}</button>;
  }
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'is light' }));
  expect(screen.getByRole('button', { name: 'is dark' })).toBeInTheDocument();
});
