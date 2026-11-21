import { useState, useEffect } from 'react';
import { api } from '../api';

function PasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function set(f) { return e => setForm(d => ({ ...d, [f]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(false);
    if (form.newPassword !== form.confirm) return setError('Passwords do not match');
    if (form.newPassword.length < 8) return setError('Password must be at least 8 characters');
    try {
      await api.put('/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setSuccess(true);
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
      {[['Current Password','currentPassword'],['New Password','newPassword'],['Confirm New Password','confirm']].map(([label, field]) => (
        <div key={field}>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
          <input type="password" value={form[field]} onChange={set(field)}
            className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" required />
        </div>
      ))}
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
      {success && <p className="text-emerald-600 dark:text-emerald-400 text-sm">Password changed.</p>}
      <button type="submit" className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700">
        Change Password
      </button>
    </form>
  );
}

function AccountsManager() {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'checking', balance: 0 });
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [syncValue, setSyncValue] = useState('');
  const [syncError, setSyncError] = useState('');

  useEffect(() => { api.get('/accounts').then(setAccounts); }, []);

  async function create() {
    const saved = await api.post('/accounts', { ...form, balance: parseFloat(form.balance) || 0 });
    setAccounts(a => [...a, saved]);
    setForm({ name: '', type: 'checking', balance: 0 });
    setShowForm(false);
  }

  async function remove(id) {
    if (!confirm('Delete this account?')) return;
    await api.delete(`/accounts/${id}`);
    setAccounts(a => a.filter(x => x.id !== id));
  }

  function startSync(account) {
    setSyncing(account.id);
    setSyncValue((account.current_balance ?? account.balance).toFixed(2));
    setSyncError('');
  }

  async function saveSync(id) {
    setSyncError('');
    const val = parseFloat(syncValue);
    if (!Number.isFinite(val)) return setSyncError('Enter a valid number');
    try {
      const updated = await api.put(`/accounts/${id}/sync`, { current_balance: val });
      setAccounts(a => a.map(x => x.id === id ? updated : x));
      setSyncing(null);
    } catch (err) {
      setSyncError(err.message || 'Failed to sync');
    }
  }

  const inputCls = "border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100";

  return (
    <div className="space-y-3">
      {accounts.map(a => (
        <div key={a.id} className="border-b border-gray-50 dark:border-gray-700 pb-2">
          <div className="flex justify-between items-center py-1 text-sm">
            <span className="text-gray-800 dark:text-gray-100 font-medium">{a.name}</span>
            <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
              <span className="capitalize">{a.type}</span>
              <span className={`font-medium ${(a.current_balance ?? a.balance) >= 0 ? 'text-gray-800 dark:text-gray-100' : 'text-red-600 dark:text-red-400'}`}>
                ${(a.current_balance ?? a.balance).toFixed(2)}
              </span>
              <button onClick={() => startSync(a)} className="text-xs text-indigo-500 dark:text-indigo-400 hover:underline">Sync</button>
              <button onClick={() => remove(a.id)} className="text-xs hover:text-red-600 dark:hover:text-red-400">Delete</button>
            </div>
          </div>
          {syncing === a.id && (
            <div className="flex items-center gap-2 mt-1 pl-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Actual bank balance:</span>
              <input
                type="number"
                step="0.01"
                value={syncValue}
                onChange={e => setSyncValue(e.target.value)}
                className={`${inputCls} w-28`}
                autoFocus
              />
              <button onClick={() => saveSync(a.id)} className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700">Save</button>
              <button onClick={() => setSyncing(null)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
              {syncError && <span className="text-xs text-red-600 dark:text-red-400">{syncError}</span>}
            </div>
          )}
        </div>
      ))}
      {showForm ? (
        <div className="flex flex-wrap gap-2 items-end mt-2">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Name" className={inputCls} />
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            className={inputCls}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="credit">Credit</option>
          </select>
          <input type="number" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))}
            placeholder="Opening balance" className={`${inputCls} w-28`} />
          <button onClick={create} className="bg-indigo-600 text-white text-sm px-3 py-1 rounded">Add</button>
          <button onClick={() => setShowForm(false)} className="text-sm border border-gray-200 dark:border-gray-600 px-3 py-1 rounded text-gray-600 dark:text-gray-300">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mt-1">+ Add account</button>
      )}
    </div>
  );
}

export default function Settings() {
  return (
    <div className="space-y-8 max-w-lg">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h1>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Change Password</h2>
        <PasswordForm />
      </section>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Accounts</h2>
        <AccountsManager />
      </section>
    </div>
  );
}
