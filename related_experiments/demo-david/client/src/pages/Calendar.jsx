import { useState, useEffect } from 'react';
import { api } from '../api';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function MonthNav({ year, month, onChange }) {
  function prev() { if (month === 1) onChange(year - 1, 12); else onChange(year, month - 1); }
  function next() { if (month === 12) onChange(year + 1, 1); else onChange(year, month + 1); }
  const label = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  return (
    <div className="flex items-center gap-3">
      <button onClick={prev} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">‹</button>
      <span className="font-semibold text-gray-900 dark:text-gray-100 min-w-[140px] text-center">{label}</span>
      <button onClick={next} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">›</button>
    </div>
  );
}

function TxChip({ tx, onClick }) {
  const isExpense = tx.amount < 0;

  if (tx.projected) {
    return (
      <button
        onClick={() => onClick(tx)}
        className="w-full text-left text-[11px] px-1.5 py-0.5 rounded border border-dashed border-indigo-400 dark:border-indigo-500/60 text-indigo-600 dark:text-indigo-400/70 truncate hover:border-indigo-600 dark:hover:border-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
        title={`${tx.description} · $${Math.abs(tx.amount).toFixed(2)} (projected)`}
      >
        ↻ {tx.description}
      </button>
    );
  }

  if (tx.is_recurring) {
    return (
      <button
        onClick={() => onClick(tx)}
        className={`w-full text-left text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/70 border border-indigo-200 dark:border-indigo-700/50 truncate hover:bg-indigo-200 dark:hover:bg-indigo-800/70 transition-colors ${isExpense ? 'text-indigo-800 dark:text-indigo-200' : 'text-emerald-700 dark:text-emerald-300'}`}
        title={`${tx.description} · ${isExpense ? '-' : '+'}$${Math.abs(tx.amount).toFixed(2)} (recurring)`}
      >
        ↻ {tx.description}
      </button>
    );
  }

  return (
    <button
      onClick={() => onClick(tx)}
      className={`w-full text-left text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60 truncate hover:bg-gray-200 dark:hover:bg-gray-600/60 transition-colors ${isExpense ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
      title={`${tx.description} · ${isExpense ? '-' : '+'}$${Math.abs(tx.amount).toFixed(2)}`}
    >
      {tx.description}
    </button>
  );
}

function DayCell({ day, txs, isToday }) {
  const [popover, setPopover] = useState(null);
  const MAX_VISIBLE = 3;
  const visible = txs.slice(0, MAX_VISIBLE);
  const overflow = txs.length - MAX_VISIBLE;

  if (!day) {
    return <div className="bg-gray-100/70 dark:bg-gray-900/30 rounded-lg min-h-[100px]" />;
  }

  return (
    <div className={`relative rounded-lg min-h-[100px] p-2 flex flex-col gap-0.5 border ${isToday ? 'border-indigo-500 bg-white dark:bg-gray-800' : 'border-gray-200 dark:border-gray-700/50 bg-white dark:bg-gray-800/50'}`}>
      <span className={`text-xs font-semibold mb-1 ${isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'}`}>
        {day}
      </span>
      {visible.map((tx, i) => (
        <TxChip key={tx.id ?? i} tx={tx} onClick={setPopover} />
      ))}
      {overflow > 0 && (
        <button
          className="text-[10px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-left mt-0.5"
          onClick={() => setPopover({ _overflow: true, txs })}
        >
          +{overflow} more
        </button>
      )}

      {/* Popover */}
      {popover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} />
          <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl shadow-xl p-3 w-64">
            <button onClick={() => setPopover(null)} className="absolute top-2 right-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-sm">✕</button>
            {popover._overflow ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">All transactions</p>
                {popover.txs.map((tx, i) => <TxDetail key={i} tx={tx} />)}
              </div>
            ) : (
              <TxDetail tx={popover} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TxDetail({ tx }) {
  const isExpense = tx.amount < 0;
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{tx.description}</p>
        {tx.projected
          ? <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-400 dark:border-indigo-500/50 px-1.5 py-0.5 rounded shrink-0">projected</span>
          : tx.is_recurring
            ? <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/50 px-1.5 py-0.5 rounded shrink-0">↻ recurring</span>
            : null
        }
      </div>
      <p className={`text-base font-bold ${isExpense ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
        {isExpense ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{tx.date}</p>
      {tx.category_name && <p className="text-xs text-gray-500">{tx.category_name}</p>}
      {tx.account_name && <p className="text-xs text-gray-500">{tx.account_name}</p>}
    </div>
  );
}

export default function Calendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState({ actual: [], projected: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/calendar/${year}/${month}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [year, month]);

  const todayStr = now.toISOString().slice(0, 10);
  const allTxs = [...data.actual, ...data.projected];

  // Group transactions by date
  const byDate = {};
  for (const tx of allTxs) {
    if (!byDate[tx.date]) byDate[tx.date] = [];
    byDate[tx.date].push(tx);
  }

  // Sort each day: projected last
  for (const date of Object.keys(byDate)) {
    byDate[date].sort((a, b) => {
      if (a.projected && !b.projected) return 1;
      if (!a.projected && b.projected) return -1;
      return 0;
    });
  }

  // Build grid cells
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const projectedCount = data.projected.length;
  const projectedExpenses = data.projected.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const projectedIncome = data.projected.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Calendar</h1>
        <MonthNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
      </div>

      {/* Legend + projected summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-gray-100 dark:bg-gray-700/60" />
            <span className="text-gray-500 dark:text-gray-400">Transaction</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-indigo-100 dark:bg-indigo-900/70 border border-indigo-200 dark:border-indigo-700/50" />
            <span className="text-gray-500 dark:text-gray-400">↻ Recurring</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded border border-dashed border-indigo-400 dark:border-indigo-500/60" />
            <span className="text-gray-500 dark:text-gray-400">Projected (future)</span>
          </div>
        </div>

        {projectedCount > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">{projectedCount} upcoming</span>
            {projectedExpenses > 0 && (
              <span className="font-semibold text-red-600 dark:text-red-400">-${projectedExpenses.toFixed(2)}</span>
            )}
            {projectedIncome > 0 && (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">+${projectedIncome.toFixed(2)}</span>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_LABELS.map(d => (
                <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                const dateStr = day
                  ? `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                  : null;
                return (
                  <DayCell
                    key={i}
                    day={day}
                    txs={dateStr ? (byDate[dateStr] ?? []) : []}
                    isToday={dateStr === todayStr}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
