import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(() => ({ login: vi.fn().mockResolvedValue(undefined) }))
}));

import { ThemeProvider } from '../ThemeContext';
import Login from '../pages/Login';

function renderLogin() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<p>sign-up page</p>} />
          <Route path="/dashboard" element={<p>dashboard page</p>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

test('renders login form', () => {
  renderLogin();
  expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
});

test('shows error on failed login', async () => {
  const { useAuth } = await import('../AuthContext');
  useAuth.mockReturnValue({
    login: vi.fn().mockRejectedValue(new Error('Invalid credentials'))
  });
  renderLogin();
  await userEvent.type(screen.getByLabelText(/username/i), 'admin');
  await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));
  await waitFor(() => {
    expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
  });
});

test('goes to the dashboard after a successful login', async () => {
  const { useAuth } = await import('../AuthContext');
  const login = vi.fn().mockResolvedValue(undefined);
  useAuth.mockReturnValue({ login });
  renderLogin();
  await userEvent.type(screen.getByLabelText(/username/i), 'admin');
  await userEvent.type(screen.getByLabelText(/password/i), 'changeme');
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));
  expect(login).toHaveBeenCalledWith('admin', 'changeme');
  expect(await screen.findByText('dashboard page')).toBeInTheDocument();
});

test('links to the sign-up page', async () => {
  renderLogin();
  await userEvent.click(screen.getByRole('link', { name: /sign up/i }));
  expect(await screen.findByText('sign-up page')).toBeInTheDocument();
});

test('has a theme toggle', () => {
  renderLogin();
  expect(screen.getByRole('button', { name: /switch to (dark|light) theme/i })).toBeInTheDocument();
});
