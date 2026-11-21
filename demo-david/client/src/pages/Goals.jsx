import { useState, useEffect } from 'react';
import { api } from '../api';

const inputCls = "w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100";

function paceText(goal) {
  if (!goal.avg_monthly_net || goal.avg_monthly_net <= 0) return { text: 'No recent savings activity', color: 'text-gray-400 dark:text-gray-500' };
  const monthly = `~$${Math.round(goal.avg_monthly_net).toLocaleString('en-CA')}/mo`;
  if (!goal.projected_date) return { text: `Saving ${monthly}`, color: 'text-gray-400 dark:text-gray-500' };
  const projected = new Date(goal.projected_date + 'T00:00:00');
  const projLabel = projected.toLocaleString('default', { month: 'short', year: 'numeric' });
  if (!goal.target_date) return { text: `Saving ${monthly} · projected ${projLabel}`, color: 'text-gray-400 dark:text-gray-500' };
  const target = new Date(goal.target_date + 'T00:00:00');
  if (projected <= target) return { text: `Saving ${monthly} · on track`, color: 'text-emerald-500 dark:text-emerald-400' };
  const diffMonths = Math.round((projected - target) / (1000 * 60 * 60 * 24 * 30));
  return { text: `Saving ${monthly} · ${diffMonths} month${diffMonths !== 1 ? 's' : ''} behind`, color: 'text-amber-500 dark:text-amber-400' };
}

function GoalCard({ goal, onEdit, onDelete, onToggleComplete }) {
  const balance = goal.account_balance ?? 0;
  const pct = goal.target_amount > 0 ? Math.min(100, balance / goal.target_amount * 100) : 0;
  const actualPct = goal.target_amount > 0 ? (balance / goal.target_amount * 100) : 0;
  const reached = balance >= goal.target_amount;
  const isCompleted = !!goal.completed_at;
  const pace = paceText(goal);

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4${isCompleted ? ' opacity-60' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-gray-900 dark:text-white">{goal.name}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {goal.account_name ?? '—'}
            {goal.target_date && ` · Due ${new Date(goal.target_date + 'T00:00:00').toLocaleString('default', { month: 'short', year: 'numeric' })}`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            ${balance.toLocaleString('en-CA', { minimumFractionDigits: 2 })}
            <span className="text-gray-400 dark:text-gray-500 font-normal"> / ${goal.target_amount.toLocaleString('en-CA', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className={`text-xs ${reached ? 'text-emerald-500' : 'text-gray-400 dark:text-gray-500'}`}>
            {actualPct.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all ${reached ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {isCompleted ? (
        <p className="text-xs text-emerald-500 mb-3">Completed {goal.completed_at}</p>
      ) : reached ? (
        <p className="text-xs text-emerald-500 mb-3">Target reached — mark as complete?</p>
      ) : (
        <p className={`text-xs mb-3 ${pace.color}`}>{pace.text}</p>
      )}

      <div className="flex gap-3">
        <button onClick={onToggleComplete} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          {isCompleted ? 'Unmark' : 'Mark complete'}
        </button>
        <button onClick={onEdit} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">Edit</button>
        <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400">Delete</button>
      </div>
    </div>
  );
}

const emptyForm = { name: '', account_id: '', target_amount: '', target_date: '' };

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editGoal, setEditGoal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/accounts').then(setAccounts);
    reload();
  }, []);

  function reload() {
    setLoading(true);
    api.get('/goals').then(setGoals).finally(() => setLoading(false));
  }

  function openAdd() {
    setEditGoal(null);
    setForm(emptyForm);
    setError('');
    setShowForm(true);
  }

  function openEdit(goal) {
    setEditGoal(goal);
    setForm({
      name: goal.name,
      account_id: goal.account_id != null ? String(goal.account_id) : '',
      target_amount: String(goal.target_amount),
      target_date: goal.target_date ?? '',
    });
    setError('');
    setShowForm(true);
  }

  async function saveGoal() {
    setError('');
    try {
      const payload = {
        name: form.name,
        account_id: form.account_id ? parseInt(form.account_id) : null,
        target_amount: parseFloat(form.target_amount),
        target_date: form.target_date || null,
      };
      if (editGoal) {
        await api.put(`/goals/${editGoal.id}`, payload);
      } else {
        await api.post('/goals', payload);
      }
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteGoal(id) {
    if (!confirm('Remove this goal?')) return;
    await api.delete(`/goals/${id}`);
    setGoals(gs => gs.filter(g => g.id !== id));
  }

  async function toggleComplete(goal) {
    await api.put(`/goals/${goal.id}/complete`, {});
    reload();
  }

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  const active = goals.filter(g => !g.completed_at);
  const completed = goals.filter(g => g.completed_at);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Savings Goals</h1>
        <button onClick={openAdd} className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-700">
          + Add Goal
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{editGoal ? 'Edit Goal' : 'New Goal'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input type="text" value={form.name} onChange={set('name')} className={inputCls} placeholder="Emergency Fund" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Target Amount</label>
              <input type="number" step="0.01" min="0.01" value={form.target_amount} onChange={set('target_amount')} className={inputCls} placeholder="5000" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Target Date <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
              </label>
              <input type="date" value={form.target_date} onChange={set('target_date')} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Account <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
              </label>
              <select value={form.account_id} onChange={set('account_id')} className={inputCls}>
                <option value="">None</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button onClick={saveGoal} className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-700">Save</button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-1.5">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 dark:text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="space-y-3">
            {active.map(g => (
              <GoalCard key={g.id} goal={g}
                onEdit={() => openEdit(g)}
                onDelete={() => deleteGoal(g.id)}
                onToggleComplete={() => toggleComplete(g)}
              />
            ))}
            {active.length === 0 && !showForm && (
              <p className="text-gray-400 dark:text-gray-500 text-sm">No active goals. Add one above.</p>
            )}
          </div>

          {completed.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Completed</h2>
              <div className="space-y-3">
                {completed.map(g => (
                  <GoalCard key={g.id} goal={g}
                    onEdit={() => openEdit(g)}
                    onDelete={() => deleteGoal(g.id)}
                    onToggleComplete={() => toggleComplete(g)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
