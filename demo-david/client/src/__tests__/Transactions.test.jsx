import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock('../components/TransactionForm', () => ({
  default: () => <div>TransactionForm</div>,
}));

vi.mock('../components/TransactionList', () => ({
  default: ({ transactions }) => (
    <ul>
      {transactions.map(tx => <li key={tx.id}>{tx.description}</li>)}
    </ul>
  ),
}));

import Transactions from '../pages/Transactions';

const TX = { id: 1, description: 'Coffee', amount: -5, date: '2026-05-01',
             category_id: null, account_id: null, category_name: null,
             account_name: null, is_recurring: 0, has_splits: 0 };

let observerCallback = null;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  observerCallback = null;
  globalThis.IntersectionObserver = class {
    constructor(cb) { observerCallback = cb; }
    observe()    {}
    disconnect() {}
  };
  const { api } = await import('../api');
  api.get.mockReset();
  api.get.mockImplementation(url => {
    if (url.startsWith('/categories')) return Promise.resolve([]);
    if (url.startsWith('/accounts'))   return Promise.resolve([]);
    return Promise.resolve({ transactions: [], hasMore: false });
  });
});

test('renders "All Time" preset by default', async () => {
  render(<Transactions />);
  expect(screen.getByDisplayValue('All Time')).toBeInTheDocument();
});

test('initial fetch uses no date params (all_time default)', async () => {
  const { api } = await import('../api');
  render(<Transactions />);
  await waitFor(() => {
    const calls = api.get.mock.calls.filter(c => c[0].startsWith('/transactions?'));
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).not.toContain('start=');
    expect(calls[0][0]).not.toContain('end=');
    expect(calls[0][0]).toContain('limit=50');
    expect(calls[0][0]).toContain('offset=0');
  });
});

test('changing preset triggers refetch with start/end params', async () => {
  const { api } = await import('../api');
  render(<Transactions />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  api.get.mockClear();

  fireEvent.change(screen.getByDisplayValue('All Time'), { target: { value: 'this_month' } });

  await waitFor(() => {
    const calls = api.get.mock.calls.filter(c => c[0].startsWith('/transactions?'));
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('start=');
    expect(calls[0][0]).toContain('end=');
  });
});

test('selecting "Custom" reveals two date inputs', async () => {
  render(<Transactions />);
  fireEvent.change(screen.getByDisplayValue('All Time'), { target: { value: 'custom' } });
  const dateInputs = screen.getAllByDisplayValue('').filter(el => el.type === 'date');
  expect(dateInputs).toHaveLength(2);
});

test('search input debounces 300ms before fetching', async () => {
  vi.useFakeTimers();
  const { api } = await import('../api');
  render(<Transactions />);
  await act(async () => { vi.runAllTimers(); });
  // Restore real timers so waitFor polling works, then check state
  vi.useRealTimers();
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  api.get.mockClear();

  fireEvent.change(screen.getByPlaceholderText(/search transactions/i), {
    target: { value: 'coffee' },
  });

  expect(api.get.mock.calls.filter(c => c[0].includes('q='))).toHaveLength(0);

  // The debounce already fired via runAllTimers above; re-test with fake timers
  vi.useFakeTimers();
  fireEvent.change(screen.getByPlaceholderText(/search transactions/i), {
    target: { value: 'coffee2' },
  });
  expect(api.get.mock.calls.filter(c => c[0].includes('q='))).toHaveLength(0);
  await act(async () => { vi.advanceTimersByTime(300); });
  vi.useRealTimers();

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('q=coffee2'));
  });
});

test('filter change resets transaction list', async () => {
  const { api } = await import('../api');
  api.get.mockImplementation(url => {
    if (url.startsWith('/categories')) return Promise.resolve([]);
    if (url.startsWith('/accounts'))   return Promise.resolve([]);
    return Promise.resolve({ transactions: [TX], hasMore: false });
  });
  render(<Transactions />);
  await waitFor(() => screen.getByText('Coffee'));
  api.get.mockClear();
  api.get.mockImplementation(url => {
    if (url.startsWith('/categories')) return Promise.resolve([]);
    if (url.startsWith('/accounts'))   return Promise.resolve([]);
    return Promise.resolve({ transactions: [], hasMore: false });
  });

  fireEvent.change(screen.getByDisplayValue('All Time'), { target: { value: 'this_month' } });

  await waitFor(() => expect(screen.queryByText('Coffee')).not.toBeInTheDocument());
});

test('shows "All transactions loaded" when hasMore is false and list is non-empty', async () => {
  const { api } = await import('../api');
  api.get.mockImplementation(url => {
    if (url.startsWith('/categories')) return Promise.resolve([]);
    if (url.startsWith('/accounts'))   return Promise.resolve([]);
    return Promise.resolve({ transactions: [TX], hasMore: false });
  });
  render(<Transactions />);
  await waitFor(() => screen.getByText('All transactions loaded'));
});

test('IntersectionObserver triggers loadMore when hasMore is true', async () => {
  const { api } = await import('../api');
  api.get.mockImplementation(url => {
    if (url.startsWith('/categories')) return Promise.resolve([]);
    if (url.startsWith('/accounts'))   return Promise.resolve([]);
    if (url.includes('offset=0')) return Promise.resolve({ transactions: [TX], hasMore: true });
    return Promise.resolve({ transactions: [], hasMore: false });
  });

  render(<Transactions />);
  await waitFor(() => screen.getByText('Coffee'));
  api.get.mockClear();

  act(() => {
    if (observerCallback) observerCallback([{ isIntersecting: true }]);
  });

  await waitFor(() => {
    const calls = api.get.mock.calls.filter(c => c[0].startsWith('/transactions?'));
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('offset=1');
  });
});
