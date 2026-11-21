import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('recharts', () => ({
  AreaChart: ({ children }) => <div>{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
}));

import { api } from '../api';
import Investments from '../pages/Investments';

const holdings = [
  { id: 1, ticker: 'AAA', shares: 10, purchase_price: 5, purchase_date: '2026-01-02', notes: '', price: { current: 6, prev_close: 5.5 } },
  { id: 2, ticker: 'BBB', shares: 4, purchase_price: 20, purchase_date: '2026-02-03', notes: '', price: { current: 18, prev_close: 19 } },
];

const historyCalls = () => api.get.mock.calls.map(([url]) => url).filter(url => url.startsWith('/investments/history/'));
const holdingsCalls = () => api.get.mock.calls.filter(([url]) => url === '/investments');

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(url => {
    if (url === '/investments') return Promise.resolve(holdings);
    return Promise.resolve({ points: [{ t: 1, price: 5 }, { t: 2, price: 6 }], meta: {} });
  });
  api.post.mockResolvedValue({});
});

test('selects the first ticker and loads its chart', async () => {
  render(<Investments />);
  expect(await screen.findByRole('heading', { name: 'AAA' })).toBeInTheDocument();
  await waitFor(() => expect(historyCalls()).toContain('/investments/history/AAA?range=1mo'));
});

test('clicking a holding switches the chart to that ticker', async () => {
  render(<Investments />);
  await screen.findByRole('heading', { name: 'AAA' });
  await userEvent.click(screen.getByText('BBB', { selector: 'span' }));
  expect(await screen.findByRole('heading', { name: 'BBB' })).toBeInTheDocument();
  await waitFor(() => expect(historyCalls()).toContain('/investments/history/BBB?range=1mo'));
});

test('adding a holding reloads the list and keeps the selected ticker', async () => {
  const { container } = render(<Investments />);
  await screen.findByRole('heading', { name: 'AAA' });
  await userEvent.click(screen.getByText('BBB', { selector: 'span' }));
  await screen.findByRole('heading', { name: 'BBB' });

  await userEvent.click(screen.getByRole('button', { name: '+ Add Holding' }));
  await userEvent.type(screen.getByPlaceholderText('YES.V'), 'ccc');
  await userEvent.type(screen.getByPlaceholderText('1000'), '3');
  await userEvent.type(screen.getByPlaceholderText('0.50'), '7');
  fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-03-04' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/investments', expect.objectContaining({
    ticker: 'ccc', shares: '3', purchase_price: '7', purchase_date: '2026-03-04',
  })));
  await waitFor(() => expect(holdingsCalls()).toHaveLength(2));
  expect(screen.getByRole('heading', { name: 'BBB' })).toBeInTheDocument();
});

test('selecting a ticker does not reload the holdings', async () => {
  render(<Investments />);
  await screen.findByRole('heading', { name: 'AAA' });
  await userEvent.click(screen.getByText('BBB', { selector: 'span' }));
  await screen.findByRole('heading', { name: 'BBB' });
  expect(holdingsCalls()).toHaveLength(1);
});

test('shows an empty state when there are no holdings', async () => {
  api.get.mockImplementation(() => Promise.resolve([]));
  render(<Investments />);
  expect(await screen.findByText(/no holdings yet/i)).toBeInTheDocument();
});
