import { useState, useEffect } from 'react';
import { api } from '../api';

export default function TransactionForm({ transaction, categories, accounts, onSave, onCancel }) {
  const [form, setForm] = useState({
    date: transaction?.date ?? new Date().toISOString().slice(0, 10),
    amount: transaction?.amount ?? '',
    description: transaction?.description ?? '',
    category_id: transaction?.category_id ?? '',
    account_id: transaction?.account_id ?? '',
    is_recurring: transaction?.is_recurring ?? false,
  });
  const [error, setError] = useState('');
  const [splits, setSplits] = useState([]);
  const [splitsLoaded, setSplitsLoaded] = useState(false);
  const [splitsLoadFailed, setSplitsLoadFailed] = useState(false);

  useEffect(() => {
    setSplits([]);
    setSplitsLoaded(false);
    setSplitsLoadFailed(false);
    if (!transaction?.id) { setSplitsLoaded(true); return; }
    api.get(`/transactions/${transaction.id}/splits`)
      .then(rows => {
        setSplits(rows.map(r => ({ category_id: r.category_id ?? '', amount: String(r.amount) })));
        setSplitsLoaded(true);
      })
      .catch(() => { setSplitsLoadFailed(true); setSplitsLoaded(true); });
  }, [transaction?.id]);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  }

  const isSplit = splits.length > 0;
  const splitSum = splits.reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
  const txTotal = Math.abs(parseFloat(form.amount) || 0);
  const splitBalanced = Math.abs(splitSum - txTotal) <= 0.01;

  function initSplit() {
    setSplits([
      { category_id: form.category_id || '', amount: txTotal ? String(txTotal) : '' },
      { category_id: '', amount: '' },
    ]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (isSplit && !splitBalanced) {
      setError(`Split amounts ($${splitSum.toFixed(2)}) must equal transaction total ($${txTotal.toFixed(2)})`);
      return;
    }

    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
      };
      const result = transaction?.id
        ? await api.put(`/transactions/${transaction.id}`, payload)
        : await api.post('/transactions', payload);

      if (isSplit && result?.id) {
        await api.put(`/transactions/${result.id}/splits`, {
          splits: splits.map(s => ({
            category_id: s.category_id || null,
            amount: parseFloat(s.amount),
          })),
        });
      } else if (!isSplit && transaction?.id && !splitsLoadFailed) {
        await api.put(`/transactions/${transaction.id}/splits`, { splits: [] });
      }

      onSave({ ...result, has_splits: isSplit ? 1 : 0 });
    } catch (err) {
      setError(err.message);
    }
  }

  const inputCls = "w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="tx-date" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
          <input id="tx-date" type="date" value={form.date} onChange={set('date')} className={inputCls} required />
        </div>
        <div>
          <label htmlFor="tx-amount" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount</label>
          <input id="tx-amount" type="number" step="0.01" value={form.amount} onChange={set('amount')}
            className={inputCls} required placeholder="-25.00" />
        </div>
      </div>
      <div>
        <label htmlFor="tx-desc" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
        <input id="tx-desc" type="text" value={form.description} onChange={set('description')} className={inputCls} required />
      </div>
      {!isSplit ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tx-cat" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Category</label>
            <div className="flex gap-1.5 items-center">
              <select id="tx-cat" value={form.category_id} onChange={set('category_id')} className={inputCls}>
                <option value="">Uncategorized</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                type="button"
                onClick={initSplit}
                disabled={!splitsLoaded}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + Split
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="tx-acc" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Account</label>
            <select id="tx-acc" value={form.account_id} onChange={set('account_id')} className={inputCls}>
              <option value="">None</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Split across envelopes</label>
            <button
              type="button"
              onClick={() => setSplits([])}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              Remove splits
            </button>
          </div>
          {splits.map((s, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select
                value={s.category_id}
                onChange={e => setSplits(prev => prev.map((r, j) => j === i ? { ...r, category_id: e.target.value } : r))}
                className={`${inputCls} flex-1`}
              >
                <option value="">Uncategorized</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={s.amount}
                onChange={e => setSplits(prev => prev.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))}
                className={`${inputCls} w-24 text-right`}
                placeholder="0.00"
              />
              <button
                type="button"
                onClick={() => setSplits(prev => prev.filter((_, j) => j !== i))}
                className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-sm leading-none"
              >✕</button>
            </div>
          ))}
          <div className="flex items-center justify-between mt-1">
            <button
              type="button"
              onClick={() => setSplits(prev => [...prev, { category_id: '', amount: '' }])}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              + Add row
            </button>
            <span className={`text-xs ${splitBalanced ? 'text-gray-400 dark:text-gray-500' : 'text-red-500 dark:text-red-400'}`}>
              ${splitSum.toFixed(2)} of ${txTotal.toFixed(2)}
            </span>
          </div>
          <div className="mt-1">
            <label htmlFor="tx-acc" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Account</label>
            <select id="tx-acc" value={form.account_id} onChange={set('account_id')} className={inputCls}>
              <option value="">None</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" checked={form.is_recurring} onChange={set('is_recurring')} />
        Recurring transaction
      </label>
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700">
          Cancel
        </button>
        <button type="submit"
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
          Save
        </button>
      </div>
    </form>
  );
}
