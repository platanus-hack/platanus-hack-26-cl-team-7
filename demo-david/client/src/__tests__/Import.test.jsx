import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), upload: vi.fn() },
}));

import { api } from '../api';
import Import from '../pages/Import';

const parsed = {
  headers: ['Date', 'Amount', 'Description'],
  preview: [{ Date: '2026-05-01', Amount: '-25.00', Description: 'Burger Barn' }],
  rows: [{ Date: '2026-05-01', Amount: '-25.00', Description: 'Burger Barn' }],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(url => Promise.resolve(
    url === '/categories' ? [{ id: 1, name: 'Restaurants', type: 'expense' }] : [],
  ));
  api.upload.mockResolvedValue(parsed);
});

async function reachMapping() {
  render(<MemoryRouter><Import /></MemoryRouter>);
  const file = new File(['Date,Amount,Description\n'], 'bank.csv', { type: 'text/csv' });
  await userEvent.upload(document.querySelector('input[type="file"]'), file);
  await userEvent.click(screen.getByRole('button', { name: /upload & parse/i }));
  await userEvent.click(await screen.findByRole('button', { name: /confirm mapping/i }));
}

test('continues to the categorize step when suggestions are available', async () => {
  api.post.mockResolvedValue({ suggestions: { 'Burger Barn': 1 } });
  await reachMapping();
  expect(await screen.findByText('Assign Categories')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith('/import/suggest', { descriptions: ['Burger Barn'] });
  expect(screen.getByText(/1 of 1 groups auto-categorized/i)).toBeInTheDocument();
});

test('continues to the categorize step when the suggestion request fails', async () => {
  api.post.mockRejectedValue(new Error('suggest failed'));
  await reachMapping();
  expect(await screen.findByText('Assign Categories')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/auto-categorized/i)).not.toBeInTheDocument());
  expect(screen.getByText(/assign a category to each group/i)).toBeInTheDocument();
});
