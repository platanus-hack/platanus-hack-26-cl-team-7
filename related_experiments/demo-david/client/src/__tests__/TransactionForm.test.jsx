import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../api', () => ({
  api: {
    post: vi.fn().mockResolvedValue({ id: 1, description: 'Test', date: '2026-05-10', amount: -25.50 }),
    put: vi.fn().mockResolvedValue({ id: 1, description: 'Updated', date: '2026-05-10', amount: -25.50 }),
  }
}));

import TransactionForm from '../components/TransactionForm';

const categories = [{ id: 1, name: 'Food', type: 'expense' }];
const accounts = [{ id: 1, name: 'Chequing', type: 'checking' }];

test('submits new transaction', async () => {
  const onSave = vi.fn();
  render(<TransactionForm categories={categories} accounts={accounts} onSave={onSave} onCancel={() => {}} />);

  const user = userEvent.setup();

  const dateInput = screen.getByLabelText(/date/i);
  const amountInput = screen.getByLabelText(/amount/i);
  const descInput = screen.getByLabelText(/description/i);

  await user.clear(dateInput);
  await user.type(dateInput, '2026-05-10');
  await user.type(amountInput, '-25.50');
  await user.type(descInput, 'Burger King');

  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
});
