import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';

const PALETTE = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6',
  '#0ea5e9', '#3b82f6',
];

const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid #374151',
  backgroundColor: '#1f2937',
  color: '#f3f4f6',
};

export default function Trends() {
  const [categories, setCategories] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [months, setMonths] = useState(12);
  const [chartData, setChartData] = useState([]);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [trendError, setTrendError] = useState('');

  // Load categories once on mount, default-check expense envelopes
  useEffect(() => {
    api.get('/categories').then(cats => {
      setCategories(cats);
      setSelectedIds(new Set(cats.filter(c => c.type === 'expense').map(c => c.id)));
    }).catch(() => setFetchError('Could not load categories.'));
  }, []);

  // Fetch trend data whenever selection or month range changes
  useEffect(() => {
    if (selectedIds.size === 0) {
      setChartData([]);
      setSeries([]);
      return;
    }
    setLoading(true);
    setTrendError('');
    const ids = [...selectedIds].join(',');
    api.get(`/budget/trends?months=${months}&category_ids=${ids}`)
      .then(({ labels, series: s }) => {
        setSeries(s);
        setChartData(labels.map((label, i) => ({
          label,
          ...Object.fromEntries(s.map(sr => [String(sr.id), sr.data[i]])),
        })));
      })
      .catch(() => setTrendError('Could not load trend data. Try again.'))
      .finally(() => setLoading(false));
  }, [selectedIds, months]);

  function toggleId(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(prev =>
      prev.size === categories.length
        ? new Set()
        : new Set(categories.map(c => c.id))
    );
  }

  const expenses = categories.filter(c => c.type === 'expense');
  const income   = categories.filter(c => c.type === 'income');

  const selectCls = "border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Trends</h1>

      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Range</label>
          <select value={months} onChange={e => setMonths(+e.target.value)} className={selectCls}>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
          </select>
          {categories.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="ml-auto text-sm text-indigo-500 hover:text-indigo-400"
            >
              {selectedIds.size === categories.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>

        {fetchError && <p className="text-red-500 text-sm">{fetchError}</p>}

        {expenses.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Expenses</p>
            <div className="flex flex-wrap gap-3">
              {expenses.map((c, i) => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleId(c.id)}
                    style={{ accentColor: PALETTE[i % PALETTE.length] }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {income.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Income</p>
            <div className="flex flex-wrap gap-3">
              {income.map((c, i) => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleId(c.id)}
                    style={{ accentColor: PALETTE[(expenses.length + i) % PALETTE.length] }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
        {loading ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm text-center py-16">Loading...</p>
        ) : trendError ? (
          <p className="text-red-500 dark:text-red-400 text-sm text-center py-16">{trendError}</p>
        ) : selectedIds.size === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm text-center py-16">Select at least one envelope to see trends.</p>
        ) : chartData.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm text-center py-16">No data for the selected period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip
                formatter={(v, name) => [`$${v.toFixed(2)}`, name]}
                contentStyle={tooltipStyle}
                itemStyle={{ color: '#f3f4f6' }}
                labelStyle={{ color: '#f3f4f6' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series.map((s, i) => (
                <Line
                  key={s.id}
                  type="monotone"
                  dataKey={String(s.id)}
                  name={s.name}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
