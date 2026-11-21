import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

function CatForm({ cat, onSave, onCancel }) {
  const [form, setForm] = useState({ ...cat });
  const inputCls = "border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100";
  return (
    <div className="flex flex-wrap gap-2 items-end py-2">
      <input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Name" className={`${inputCls} w-36`} />
      <select value={form.type || 'expense'} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
        className={inputCls}>
        <option value="expense">Expense</option>
        <option value="income">Income</option>
      </select>
      <input type="number" value={form.default_allocation || 0}
        onChange={e => setForm(f => ({ ...f, default_allocation: parseFloat(e.target.value) || 0 }))}
        placeholder="Default $" className={`${inputCls} w-24`} />
      <label className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
        <input type="checkbox" checked={!!form.rollover}
          onChange={e => setForm(f => ({ ...f, rollover: e.target.checked }))} />
        Rollover
      </label>
      <button onClick={() => onSave(form)} className="bg-indigo-600 text-white text-sm px-3 py-1 rounded">Save</button>
      <button onClick={onCancel} className="text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 px-3 py-1 rounded">Cancel</button>
    </div>
  );
}

export default function Envelopes() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [envelopes, setEnvelopes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null);
  const [newCat, setNewCat] = useState({ name: '', type: 'expense', default_allocation: 0, rollover: false });
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromCategoryId: 0, toCategoryId: 0, amount: '' });
  const [transferError, setTransferError] = useState('');

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;

  const loadData = useCallback(async () => {
    setLoading(true);
    const [env, cats] = await Promise.all([api.get(`/budget/${year}/${month}`), api.get('/categories')]);
    setEnvelopes(env);
    setCategories(cats);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { loadData(); }, [loadData]);

  async function updateAllocation(categoryId, allocated) {
    const updated = await api.put(`/budget/${year}/${month}/${categoryId}`, { allocated: parseFloat(allocated) });
    setEnvelopes(es => es.map(e => e.category_id === categoryId ? { ...e, allocated: updated.allocated } : e));
  }

  async function saveCategory(cat) {
    if (cat.id) await api.put(`/categories/${cat.id}`, cat);
    else await api.post('/categories', cat);
    setEditing(null);
    setShowNew(false);
    setNewCat({ name: '', type: 'expense', default_allocation: 0, rollover: false });
    loadData();
  }

  async function deleteCategory(id) {
    if (!confirm('Delete this category? Transactions will become uncategorized.')) return;
    await api.delete(`/categories/${id}`);
    loadData();
  }

  async function rolloverToNextMonth() {
    const toMonth = month === 12 ? 1 : month + 1;
    const toYear = month === 12 ? year + 1 : year;
    await api.post('/budget/rollover', { fromYear: year, fromMonth: month, toYear, toMonth });
    alert(`Rolled over to ${new Date(toYear, toMonth - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}`);
  }

  function openTransfer() {
    const first  = envelopes[0]?.category_id ?? 0;
    const second = envelopes[1]?.category_id ?? 0;
    setTransferForm({ fromCategoryId: first, toCategoryId: second, amount: '' });
    setTransferError('');
    setShowTransfer(true);
  }

  async function handleTransfer() {
    setTransferError('');
    const amount = parseFloat(transferForm.amount);
    if (!amount || amount <= 0) { setTransferError('Amount must be greater than 0.'); return; }
    if (transferForm.fromCategoryId === transferForm.toCategoryId) { setTransferError('From and To must be different.'); return; }
    try {
      await api.post('/budget/transfer', {
        year, month,
        fromCategoryId: transferForm.fromCategoryId,
        toCategoryId: transferForm.toCategoryId,
        amount,
      });
      setShowTransfer(false);
      setTransferError('');
      loadData();
    } catch (err) {
      setTransferError(err.message || 'Transfer failed.');
    }
  }

  async function copyFromPreviousMonth() {
    const fromLabel = new Date(prevYear, prevMonth - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    if (!confirm(`Copy allocations from ${fromLabel}? This will overwrite current values.`)) return;
    const { updated } = await api.post('/budget/copy', { fromYear: prevYear, fromMonth: prevMonth, toYear: year, toMonth: month });
    if (updated === 0) {
      alert('Nothing to copy — previous month has no allocations.');
      return;
    }
    loadData();
  }

  const selectCls = "border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Envelopes</h1>
        <div className="flex gap-2">
          <button
            onClick={openTransfer}
            disabled={envelopes.length < 2}
            className="text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Transfer
          </button>
          <button onClick={copyFromPreviousMonth} className="text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">
            Copy from {new Date(prevYear, prevMonth - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
          </button>
          <button onClick={rolloverToNextMonth} className="text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">
            Rollover to next month
          </button>
          <button onClick={() => setShowNew(true)} className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-700">
            + Category
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <select value={year} onChange={e => setYear(+e.target.value)} className={selectCls}>
          {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(+e.target.value)} className={selectCls}>
          {Array.from({length:12},(_,i)=>i+1).map(m => (
            <option key={m} value={m}>{new Date(2000,m-1).toLocaleString('default',{month:'long'})}</option>
          ))}
        </select>
      </div>

      {showNew && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">New Category</h3>
          <CatForm cat={newCat} onSave={saveCategory} onCancel={() => setShowNew(false)} />
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        {loading ? (
          <p className="text-gray-400 dark:text-gray-500 p-4 text-center">Loading...</p>
        ) : envelopes.map(env => (
          <div key={env.id} className="px-4 py-3">
            {editing === env.category_id ? (
              <CatForm
                cat={categories.find(c => c.id === env.category_id) || {}}
                onSave={saveCategory}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{env.name}</span>
                  {env.rollover === 1 && <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 rounded">Rollover</span>}
                  {env.rolled_over > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">+${env.rolled_over.toFixed(2)} carried</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <input
                    type="number"
                    defaultValue={env.allocated}
                    onBlur={e => updateAllocation(env.category_id, e.target.value)}
                    className="border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm w-24 text-right bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                  />
                  <button onClick={() => setEditing(env.category_id)} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Edit</button>
                  <button onClick={() => deleteCategory(env.category_id)} className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showTransfer && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowTransfer(false); setTransferError(''); }} />
          <div className="relative bg-white dark:bg-gray-800 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900 dark:text-white">Transfer Budget</h2>
              <button onClick={() => { setShowTransfer(false); setTransferError(''); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
                <select
                  value={transferForm.fromCategoryId}
                  onChange={e => setTransferForm(f => ({ ...f, fromCategoryId: +e.target.value }))}
                  className={`${selectCls} w-full`}
                >
                  {envelopes.map(e => (
                    <option key={e.category_id} value={e.category_id}>
                      {e.name} (${e.allocated.toFixed(2)} allocated)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
                <select
                  value={transferForm.toCategoryId}
                  onChange={e => setTransferForm(f => ({ ...f, toCategoryId: +e.target.value }))}
                  className={`${selectCls} w-full`}
                >
                  {envelopes
                    .filter(e => e.category_id !== transferForm.fromCategoryId)
                    .map(e => (
                      <option key={e.category_id} value={e.category_id}>{e.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={transferForm.amount}
                  onChange={e => setTransferForm(f => ({ ...f, amount: e.target.value }))}
                  className={`${selectCls} w-full text-right`}
                />
              </div>
              {transferError && <p className="text-red-600 dark:text-red-400 text-sm">{transferError}</p>}
              <button onClick={handleTransfer} className="w-full bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700">
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
