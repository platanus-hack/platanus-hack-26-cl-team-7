import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn()
}));

import { useAuth } from '../AuthContext';
import { ThemeProvider } from '../ThemeContext';
import SignUp from '../pages/SignUp';

function renderSignUp(signup = vi.fn().mockResolvedValue(undefined)) {
  useAuth.mockReturnValue({ signup });
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<SignUp />} />
          <Route path="/login" element={<p>login page</p>} />
          <Route path="/dashboard" element={<p>dashboard page</p>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
  return signup;
}

async function fill(username, password, confirm) {
  await userEvent.type(screen.getByLabelText('Username'), username);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
}

test('renders the sign-up form', () => {
  renderSignUp();
  expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
  expect(screen.getByLabelText('Username')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
});

test('creates the account and opens the dashboard', async () => {
  const signup = renderSignUp();
  await fill('  newcomer ', 'long-enough-1', 'long-enough-1');
  expect(signup).toHaveBeenCalledWith('newcomer', 'long-enough-1');
  expect(await screen.findByText('dashboard page')).toBeInTheDocument();
});

test('does not call the server when the passwords differ', async () => {
  const signup = renderSignUp();
  await fill('newcomer', 'long-enough-1', 'long-enough-2');
  expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
  expect(signup).not.toHaveBeenCalled();
});

test('does not call the server when the password is shorter than 8 characters', async () => {
  const signup = renderSignUp();
  await fill('newcomer', 'short', 'short');
  expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 8 characters');
  expect(signup).not.toHaveBeenCalled();
});

test('shows the message the server sends, such as a taken username, and stays on the page', async () => {
  renderSignUp(vi.fn().mockRejectedValue(new Error('Username already taken')));
  await fill('admin', 'long-enough-1', 'long-enough-1');
  expect(await screen.findByText('Username already taken')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign up' })).toBeEnabled();
});

test('links back to the login page', async () => {
  renderSignUp();
  await userEvent.click(screen.getByRole('link', { name: 'Log in' }));
  expect(await screen.findByText('login page')).toBeInTheDocument();
});
