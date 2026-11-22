import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../api', () => ({
  api: {
    get: vi.fn((url) => {
      if (url === '/categories') {
        return Promise.resolve([
          { id: 1, name: 'Groceries', type: 'expense' },
          { id: 2, name: 'Rent',      type: 'expense' },
          { id: 3, name: 'Salary',    type: 'income'  },
        ]);
      }
      // trends endpoint
      return Promise.resolve({ labels: [], series: [] });
    }),
  },
}));

vi.mock('recharts', () => ({
  LineChart: ({ children }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
}));

import Trends from '../pages/Trends';

async function renderTrends() {
  render(<Trends />);
  // wait for categories to load
  await waitFor(() => screen.getByText('Groceries'));
}

test('renders Select All / Deselect All button', async () => {
  await renderTrends();
  // all expense categories are selected by default, but not income → shows "Select All"
  expect(screen.getByRole('button', { name: /select all/i })).toBeInTheDocument();
});

test('Deselect All button appears when all categories are selected', async () => {
  await renderTrends();
  // click Select All to select everything
  await userEvent.click(screen.getByRole('button', { name: /select all/i }));
  expect(screen.getByRole('button', { name: /deselect all/i })).toBeInTheDocument();
});

test('Select All button reappears after Deselect All is clicked', async () => {
  await renderTrends();
  await userEvent.click(screen.getByRole('button', { name: /select all/i }));
  await userEvent.click(screen.getByRole('button', { name: /deselect all/i }));
  expect(screen.getByRole('button', { name: /select all/i })).toBeInTheDocument();
});

test('Deselect All clears all checkboxes', async () => {
  await renderTrends();
  await userEvent.click(screen.getByRole('button', { name: /select all/i }));
  await userEvent.click(screen.getByRole('button', { name: /deselect all/i }));
  const checkboxes = screen.getAllByRole('checkbox');
  checkboxes.forEach(cb => expect(cb).not.toBeChecked());
});

test('Select All checks all checkboxes', async () => {
  await renderTrends();
  await userEvent.click(screen.getByRole('button', { name: /select all/i }));
  const checkboxes = screen.getAllByRole('checkbox');
  checkboxes.forEach(cb => expect(cb).toBeChecked());
});
