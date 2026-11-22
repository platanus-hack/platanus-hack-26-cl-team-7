import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/rules'), api.get('/categories')])
      .then(([r, c]) => { setRules(r); setCategories(c); })
      .catch(err => setError(err.message || 'Failed to load'));
  }, []);

  async function add() {
    setError('');
    if (!keyword.trim()) return setError('Keyword is required');
    if (!categoryId) return setError('Category is required');
    try {
      const rule = await api.post('/rules', { keyword: keyword.trim(), category_id: parseInt(categoryId) });
      setRules(r => [rule, ...r]);
      setKeyword('');
      setCategoryId('');
    } catch (err) {
      setError(err.message || 'Failed to add rule');
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/rules/${id}`);
      setRules(r => r.filter(x => x.id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete rule');
    }
  }

  const inputCls = "border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100";

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Categorization Rules</h1>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Add Rule</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">If description contains</label>
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="e.g. RUNPOD"
              className={`${inputCls} w-48`}
              onKeyDown={e => e.key === 'Enter' && add()}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Assign to</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={inputCls}>
              <option value="">— select category —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button onClick={add} className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-700">
            Add Rule
          </button>
        </div>
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
        {rules.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 p-5">No rules yet. Add one above to auto-categorize future imports.</p>
        ) : rules.map(r => (
          <div key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded">{r.keyword}</span>
              <span className="text-gray-400 dark:text-gray-500">→</span>
              <span className="text-gray-800 dark:text-gray-100">{r.category_name}</span>
            </div>
            <button onClick={() => remove(r.id)} className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
