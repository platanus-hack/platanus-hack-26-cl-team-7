import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import ThemeToggle from './ThemeToggle';

const links = [
  { to: '/dashboard',    label: 'Dashboard' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/import',       label: 'Import' },
  { to: '/envelopes',    label: 'Envelopes' },
  { to: '/debt',         label: 'Debt' },
  { to: '/calendar',     label: 'Calendar' },
  { to: '/trends',       label: 'Trends' },
  { to: '/goals',        label: 'Goals' },
  { to: '/investments',  label: 'Investments' },
  { to: '/settings',     label: 'Settings' },
];

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Top nav */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-lg text-indigo-700 dark:text-indigo-400">Mitch&apos;s Budget</span>
        <div className="hidden sm:flex gap-1">
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm font-medium ${isActive
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
            Log out
          </button>
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex justify-around py-2 z-10">
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `text-xs px-2 py-1 rounded ${isActive ? 'text-indigo-700 dark:text-indigo-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6 pb-24 sm:pb-6">
        <Outlet />
      </main>
    </div>
  );
}
