import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { api } from '../api';

function Stat({ label, value, sub, color }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
      <p className={`font-bold text-sm ${color || 'text-gray-800 dark:text-gray-100'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function EnvelopeDetail({ envelope, accountId, year, month, onClose }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (accountId) params.set('account_id', accountId);
    if (year) params.set('year', year);
    if (month) params.set('month', month);
    const qs = params.toString() ? `?${params}` : '';
    api.get(`/budget/category/${envelope.category_id}/history${qs}`)
      .then(setData).catch(() => {});
  }, [envelope.category_id, accountId, year, month]);

  const history = data?.history ?? [];
  const currentIdx = history.length - 1;
  const current = history[currentIdx];
  const lastMonth = history[currentIdx - 1];
  const avg = history.length
    ? history.reduce((s, h) => s + h.spent, 0) / history.filter(h => h.spent > 0).length || 0
    : 0;
  const peak = history.reduce((max, h) => h.spent > max.spent ? h : max, { spent: 0, label: '—' });
  const trend = lastMonth?.spent > 0
    ? ((current?.spent - lastMonth.spent) / lastMonth.spent * 100).toFixed(0)
    : null;

  const total = envelope.allocated + envelope.rolled_over;
  const spent = Math.abs(envelope.spent);
  const remaining = total + envelope.spent;
  const over = remaining < 0;
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;

  const tooltipStyle = {
    fontSize: 12,
    borderRadius: 8,
    border: '1px solid #374151',
    backgroundColor: '#1f2937',
    color: '#f3f4f6',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white text-lg">{envelope.name}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{envelope.type}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* This month progress */}
          <div>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-600 dark:text-gray-300">${spent.toFixed(2)} spent</span>
              <span className={over ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}>
                {over ? `$${Math.abs(remaining).toFixed(2)} over` : `$${remaining.toFixed(2)} left`} of ${total.toFixed(2)}
              </span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full ${over ? 'bg-red-400' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat
              label="Last month"
              value={lastMonth ? `$${lastMonth.spent.toFixed(2)}` : '—'}
              sub={lastMonth?.count ? `${lastMonth.count} transactions` : undefined}
            />
            <Stat
              label="Monthly avg"
              value={avg > 0 ? `$${avg.toFixed(2)}` : '—'}
              sub="non-zero months"
            />
            <Stat
              label="vs last month"
              value={trend !== null ? `${trend > 0 ? '+' : ''}${trend}%` : '—'}
              color={trend === null ? undefined : +trend > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
              sub={trend !== null ? (+trend > 0 ? 'up' : 'down') : undefined}
            />
            <Stat
              label="Peak month"
              value={peak.spent > 0 ? `$${peak.spent.toFixed(2)}` : '—'}
              sub={peak.label !== '—' ? peak.label : undefined}
            />
            <Stat
              label="This month txns"
              value={current?.count ?? '—'}
            />
            {data?.largest && (
              <Stat
                label="Largest purchase"
                value={`$${Math.abs(data.largest.amount).toFixed(2)}`}
                sub={data.largest.date}
              />
            )}
          </div>

          {/* Recent transactions */}
          {data?.recentTxs?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Transactions</p>
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {data.recentTxs.map((tx, i) => (
                  <div key={i} className="flex justify-between items-center py-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-gray-700 dark:text-gray-200 truncate">{tx.description}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{tx.date}{tx.account_name ? ` · ${tx.account_name}` : ''}</p>
                    </div>
                    <span className={`shrink-0 ml-3 font-medium ${tx.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 12-month bar chart */}
          {history.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Last 12 months</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={history} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip
                    formatter={v => [`$${v.toFixed(2)}`, 'Spent']}
                    contentStyle={tooltipStyle}
                  />
                  {total > 0 && <ReferenceLine y={total} stroke="#6366f1" strokeDasharray="3 3" label={{ value: 'budget', fontSize: 10, fill: '#6366f1' }} />}
                  <Bar dataKey="spent" radius={[4, 4, 0, 0]}>
                    {history.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={i === currentIdx ? (over ? '#f87171' : '#34d399') : '#4b5563'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
