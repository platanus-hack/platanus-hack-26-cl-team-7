import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from '../api';
import Envelopes from '../pages/Envelopes';

const envelopes = [
  { id: 1, category_id: 1, name: 'Groceries', allocated: 400, rolled_over: 0, rollover: 0 },
  { id: 2, category_id: 2, name: 'Rent', allocated: 1200, rolled_over: 0, rollover: 0 },
];
const categories = [
  { id: 1, name: 'Groceries', type: 'expense', default_allocation: 400, rollover: 0 },
  { id: 2, name: 'Rent', type: 'expense', default_allocation: 1200, rollover: 0 },
];

const budgetCalls = () => api.get.mock.calls.filter(([url]) => url.startsWith('/budget/'));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(url => {
    if (url === '/categories') return Promise.resolve(categories);
    return Promise.resolve(envelopes);
  });
  api.post.mockResolvedValue({});
  api.put.mockResolvedValue({});
});

async function renderEnvelopes() {
  render(<Envelopes />);
  await screen.findByText('Groceries');
}

test('loads the envelopes for the current month once', async () => {
  await renderEnvelopes();
  const now = new Date();
  expect(budgetCalls()).toEqual([[`/budget/${now.getFullYear()}/${now.getMonth() + 1}`]]);
});

test('re-rendering without changing the month does not reload', async () => {
  await renderEnvelopes();
  await userEvent.click(screen.getByRole('button', { name: '+ Category' }));
  await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
  expect(budgetCalls()).toHaveLength(1);
});

test('changing the month loads that month', async () => {
  await renderEnvelopes();
  const now = new Date();
  const target = now.getMonth() + 1 === 3 ? 4 : 3;
  await userEvent.selectOptions(screen.getAllByRole('combobox')[1], String(target));
  await waitFor(() => expect(budgetCalls().at(-1)).toEqual([`/budget/${now.getFullYear()}/${target}`]));
});

test('changing the year loads that year', async () => {
  await renderEnvelopes();
  const now = new Date();
  const target = now.getFullYear() === 2025 ? 2026 : 2025;
  await userEvent.selectOptions(screen.getAllByRole('combobox')[0], String(target));
  await waitFor(() => expect(budgetCalls().at(-1)).toEqual([`/budget/${target}/${now.getMonth() + 1}`]));
});

test('a new category is created with POST and the envelopes reload', async () => {
  await renderEnvelopes();
  await userEvent.click(screen.getByRole('button', { name: '+ Category' }));
  await userEvent.type(screen.getByPlaceholderText('Name'), 'Books');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/categories',
    expect.objectContaining({ name: 'Books', type: 'expense' }),
  ));
  expect(api.put).not.toHaveBeenCalled();
  await waitFor(() => expect(budgetCalls()).toHaveLength(2));
});

test('an existing category is saved with PUT', async () => {
  await renderEnvelopes();
  await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  const name = screen.getByPlaceholderText('Name');
  await userEvent.clear(name);
  await userEvent.type(name, 'Food');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/categories/1',
    expect.objectContaining({ id: 1, name: 'Food' }),
  ));
  expect(api.post).not.toHaveBeenCalled();
});
