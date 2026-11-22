import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import TransactionList from '../components/TransactionList';
import TransactionForm from '../components/TransactionForm';
import { datePresetToRange } from '../utils/datePreset';

const PRESETS = [
  { value: 'all_time',      label: 'All Time' },
  { value: 'this_month',    label: 'This Month' },
  { value: 'last_month',    label: 'Last Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year',     label: 'This Year' },
  { value: 'custom',        label: 'Custom' },
];

const PAGE_SIZE = 50;

function buildParams({ datePreset, customStart, customEnd, query, filterSign, filterEnvelope, filterAccount }, offset) {
  const range = datePresetToRange(datePreset, customStart, customEnd);
  const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (range.start) p.set('start', range.start);
  if (range.end)   p.set('end',   range.end);
  if (query)       p.set('q',     query);
  if (filterSign === 'positive') p.set('type', 'income');
  if (filterSign === 'negative') p.set('type', 'expense');
  if (filterEnvelope === 'none')     p.set('category_id', 'none');
  else if (filterEnvelope !== 'all') p.set('category_id', String(filterEnvelope));
  if (filterAccount !== 'all')       p.set('account_id',  String(filterAccount));
  return p.toString();
}

export default function Transactions() {
  const [datePreset,     setDatePreset]     = useState('all_time');
  const [customStart,    setCustomStart]    = useState('');
  const [customEnd,      setCustomEnd]      = useState('');
  const [queryInput,     setQueryInput]     = useState('');
  const [query,          setQuery]          = useState('');
  const [filterSign,     setFilterSign]     = useState('all');
  const [filterEnvelope, setFilterEnvelope] = useState('all');
  const [filterAccount,  setFilterAccount]  = useState('all');
  const [transactions,   setTransactions]   = useState([]);
  const [hasMore,        setHasMore]        = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [fetchError,     setFetchError]     = useState('');
  const [loadingMore,    setLoadingMore]    = useState(false);
  const [categories,     setCategories]     = useState([]);
  const [accounts,       setAccounts]       = useState([]);
  const [editing,        setEditing]        = useState(null);

  const sentinelRef    = useRef(null);
  const loadMoreRef    = useRef(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    Promise.all([api.get('/categories'), api.get('/accounts')])
      .then(([cats, accs]) => { setCategories(cats); setAccounts(accs); });
  }, []);

  // Debounce search input 300ms
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 300);
    return () => clearTimeout(t);
  }, [queryInput]);

  // Fetch page 1 whenever any filter changes
  useEffect(() => {
    if (datePreset === 'custom' && (!customStart || !customEnd)) return;
    const filters = { datePreset, customStart, customEnd, query, filterSign, filterEnvelope, filterAccount };
    setLoading(true);
    setTransactions([]);
    setHasMore(false);
    setFetchError('');
    api.get(`/transactions?${buildParams(filters, 0)}`)
      .then(({ transactions: txs, hasMore: more }) => {
        setTransactions(txs);
        setHasMore(more);
      })
      .catch(() => setFetchError('Could not load transactions. Try again.'))
      .finally(() => setLoading(false));
  }, [datePreset, customStart, customEnd, query, filterSign, filterEnvelope, filterAccount]);

  // loadMore — ref keeps observer callback pointed at latest closure
  function loadMore() {
    if (!hasMore || loading || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const filters = { datePreset, customStart, customEnd, query, filterSign, filterEnvelope, filterAccount };
    api.get(`/transactions?${buildParams(filters, transactions.length)}`)
      .then(({ transactions: txs, hasMore: more }) => {
        setTransactions(prev => [...prev, ...txs]);
        setHasMore(more);
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }
  loadMoreRef.current = loadMore;

  // Infinite scroll — set up once, always calls latest loadMore via ref
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && loadMoreRef.current) loadMoreRef.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleSave(tx) {
    if (editing?.id) {
      setTransactions(ts => ts.map(t => t.id === tx.id ? tx : t));
    } else {
      setTransactions(ts => [tx, ...ts]);
    }
    setEditing(null);
  }

  function handleEdit(tx) {
    setEditing(tx);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(id) {
    if (!confirm('Delete this transaction?')) return;
    await api.delete(`/transactions/${id}`);
    setTransactions(ts => ts.filter(t => t.id !== id));
  }

  const selectCls = "border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Transactions</h1>
        <div className="flex gap-2">
          <Link to="/import" className="text-sm px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Import</Link>
          <Link to="/envelopes" className="text-sm px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Manage Envelopes</Link>
          <button onClick={() => setEditing(false)} className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-700">+ Add</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select value={datePreset} onChange={e => setDatePreset(e.target.value)} className={selectCls}>
          {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {datePreset === 'custom' && (
          <>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className={selectCls} />
            <input type="date" value={customEnd}   onChange={e => setCustomEnd(e.target.value)}   className={selectCls} />
          </>
        )}
        <input
          type="text"
          value={queryInput}
          onChange={e => setQueryInput(e.target.value)}
          placeholder="Search transactions…"
          className={`${selectCls} flex-1 min-w-0`}
        />
        <select value={filterSign} onChange={e => setFilterSign(e.target.value)} className={selectCls}>
          <option value="all">+ and −</option>
          <option value="positive">+ Income only</option>
          <option value="negative">− Expenses only</option>
        </select>
        <select value={filterEnvelope} onChange={e => setFilterEnvelope(e.target.value)} className={selectCls}>
          <option value="all">All envelopes</option>
          <option value="none">Uncategorized</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} className={selectCls}>
          <option value="all">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {editing !== null && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">
            {editing ? 'Edit Transaction' : 'New Transaction'}
          </h2>
          <TransactionForm
            transaction={editing || undefined}
            categories={categories}
            accounts={accounts}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4">
        {loading
          ? <p className="text-gray-400 dark:text-gray-500 py-4 text-center">Loading…</p>
          : fetchError
            ? <p className="text-red-500 dark:text-red-400 text-sm py-4 text-center">{fetchError}</p>
            : <TransactionList transactions={transactions} onEdit={handleEdit} onDelete={handleDelete} />
        }
        <div ref={sentinelRef} className="py-2 text-center text-sm text-gray-400 dark:text-gray-500">
          {loadingMore && 'Loading more…'}
          {!hasMore && transactions.length > 0 && !loading && 'All transactions loaded'}
        </div>
      </div>
    </div>
  );
}
