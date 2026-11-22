import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

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
const tooltipItemStyle = { color: '#f3f4f6' };
const tooltipLabelStyle = { color: '#f3f4f6' };

function DonutSection({ items, total }) {
  const data = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value);
  if (!data.length) return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No data for this period.</p>;

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v, name) => [`$${v.toFixed(2)}`, name]} contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} />
        </PieChart>
      </ResponsiveContainer>

      <div className="space-y-0.5">
        {data.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{item.name}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              <span className="text-xs text-gray-400 dark:text-gray-500 w-8 text-right">
                {total > 0 ? `${Math.round((item.value / total) * 100)}%` : '—'}
              </span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white w-20 text-right">
                ${item.value.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
        <div className="border-t border-gray-100 dark:border-gray-700 pt-2 mt-1 flex justify-between text-sm font-bold">
          <span className="text-gray-700 dark:text-gray-200">Total</span>
          <span className="text-gray-900 dark:text-white">${total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

function MiniDonut({ items, label }) {
  const data = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((s, i) => s + i.value, 0);

  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 text-center">{label}</p>
      {data.length > 0 ? (
        <>
          <div className="flex justify-center">
            <PieChart width={120} height={120}>
              <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={2}>
                {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip formatter={(v, name) => [`$${v.toFixed(2)}`, name]} contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} />
            </PieChart>
          </div>
          <p className="text-center text-sm font-bold text-gray-900 dark:text-white mt-1">${total.toFixed(2)}</p>
          <div className="mt-2 space-y-1">
            {data.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="text-gray-600 dark:text-gray-300 truncate">{item.name}</span>
                </div>
                <span className="text-gray-900 dark:text-white font-medium shrink-0">${item.value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No data.</p>
      )}
    </div>
  );
}

export default function SummaryModal({ type, expenses, income, onClose }) {
  const budgetedItems = expenses.map(e => ({ name: e.name, value: e.allocated + e.rolled_over }));
  const spentItems    = expenses.map(e => ({ name: e.name, value: Math.max(0, -e.spent) }));
  const earnedItems   = income.map(e =>  ({ name: e.name, value: Math.max(0, e.spent) }));

  const totalBudgeted = budgetedItems.reduce((s, i) => s + i.value, 0);
  const totalSpent    = spentItems.reduce((s, i) => s + i.value, 0);
  const totalEarned   = earnedItems.reduce((s, i) => s + i.value, 0);
  const net = totalEarned - totalSpent;

  const config = {
    budgeted: { title: 'Budgeted',  subtitle: 'Allocation across expense envelopes', items: budgetedItems, total: totalBudgeted },
    spent:    { title: 'Spent',     subtitle: 'Spending by envelope this month',      items: spentItems,    total: totalSpent },
    earned:   { title: 'Earned',    subtitle: 'Income by source this month',          items: earnedItems,   total: totalEarned },
  };

  const isNet = type === 'net';
  const c = isNet ? null : config[type];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white text-lg">{isNet ? 'Net' : c.title}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {isNet ? 'Income vs expenses this month' : c.subtitle}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4">
          {isNet ? (
            <div className="space-y-5">
              <div className="flex gap-4">
                <MiniDonut items={earnedItems} label="Income" />
                <div className="w-px bg-gray-100 dark:bg-gray-700 self-stretch" />
                <MiniDonut items={spentItems} label="Expenses" />
              </div>
              <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Total earned</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">+${totalEarned.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Total spent</span>
                  <span className="font-semibold text-red-600 dark:text-red-400">-${totalSpent.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-100 dark:border-gray-700">
                  <span className="text-gray-700 dark:text-gray-200">Net</span>
                  <span className={net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    {net >= 0 ? '+' : ''}${net.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <DonutSection items={c.items} total={c.total} />
          )}
        </div>
      </div>
    </div>
  );
}
