import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import ThemeToggle from '../components/ThemeToggle';

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

export default function SignUp() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    setLoading(true);
    try {
      await signup(username.trim(), password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-indigo-700 dark:text-indigo-400 mb-1">Create an account</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Pick a username and a password to get started.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="signup-username" className={labelCls}>Username</label>
            <input
              id="signup-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={inputCls}
              required
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">3 to 32 letters, numbers, dots, dashes or underscores.</p>
          </div>
          <div>
            <label htmlFor="signup-password" className={labelCls}>Password</label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={inputCls}
              required
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">At least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="signup-confirm" className={labelCls}>Confirm password</label>
            <input
              id="signup-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className={inputCls}
              required
            />
          </div>
          {error && <p role="alert" className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Sign up'}
          </button>
        </form>
        <p className="mt-6 text-sm text-center text-gray-600 dark:text-gray-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-700 dark:text-indigo-400 hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}
