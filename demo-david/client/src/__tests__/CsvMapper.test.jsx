import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import CsvMapper from '../components/CsvMapper';

const headers = ['Date', 'Amount', 'Description'];
const preview = [
  { Date: '2026-05-01', Amount: '-25.00', Description: 'Burger King' },
];

test('renders column selectors for date, amount, description', () => {
  render(<CsvMapper headers={headers} preview={preview} onConfirm={vi.fn()} />);
  expect(screen.getByLabelText(/date column/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/amount column/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/description column/i)).toBeInTheDocument();
});

test('calls onConfirm with mapping when submitted', async () => {
  const onConfirm = vi.fn();
  render(<CsvMapper headers={headers} preview={preview} onConfirm={onConfirm} />);
  await userEvent.click(screen.getByRole('button', { name: /confirm mapping/i }));
  expect(onConfirm).toHaveBeenCalledWith({
    date: expect.any(String),
    amount: expect.any(String),
    description: expect.any(String),
  });
});
