import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

import { ThemeProvider } from '../ThemeContext';
import Layout from '../components/Layout';

function renderLayout() {
  return render(<ThemeProvider><MemoryRouter><Layout /></MemoryRouter></ThemeProvider>);
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
});

test('shows the app name and the navigation links', () => {
  renderLayout();
  expect(screen.getByText("Mitch's Budget")).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Envelopes' }).length).toBeGreaterThan(0);
});

test('has a theme toggle next to Log out that switches the page theme', async () => {
  renderLayout();
  expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});
