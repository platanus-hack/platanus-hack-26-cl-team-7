import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn() },
}));

import { api } from '../api';
import Calendar from '../pages/Calendar';

function startAt(year, monthIndex) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(year, monthIndex, 15, 12));
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ actual: [], projected: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderCalendar() {
  render(<Calendar />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
}

test('loads the current month on first render', async () => {
  startAt(2026, 4);
  await renderCalendar();
  expect(api.get).toHaveBeenCalledWith('/calendar/2026/5');
});

test('next month loads the following month', async () => {
  startAt(2026, 4);
  await renderCalendar();
  await userEvent.click(screen.getByRole('button', { name: '›' }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/calendar/2026/6'));
});

test('previous month loads the preceding month', async () => {
  startAt(2026, 4);
  await renderCalendar();
  await userEvent.click(screen.getByRole('button', { name: '‹' }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/calendar/2026/4'));
});

test('previous month from January goes to December of the previous year', async () => {
  startAt(2026, 0);
  await renderCalendar();
  await userEvent.click(screen.getByRole('button', { name: '‹' }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/calendar/2025/12'));
});

test('next month from December goes to January of the next year', async () => {
  startAt(2025, 11);
  await renderCalendar();
  await userEvent.click(screen.getByRole('button', { name: '›' }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/calendar/2026/1'));
});

test('shows a transaction on its day', async () => {
  startAt(2026, 4);
  api.get.mockResolvedValue({
    actual: [{ id: 1, date: '2026-05-10', amount: -12.5, description: 'Corner Cafe', is_recurring: 0 }],
    projected: [],
  });
  await renderCalendar();
  expect(await screen.findByText('Corner Cafe')).toBeInTheDocument();
});
