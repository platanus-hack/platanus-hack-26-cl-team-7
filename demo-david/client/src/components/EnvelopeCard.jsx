export default function EnvelopeCard({ envelope }) {
  const total = envelope.allocated + envelope.rolled_over;
  const spent = Math.abs(envelope.spent);
  const remaining = total + envelope.spent; // spent is negative
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  const over = remaining < 0;

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border ${over ? 'border-red-200 dark:border-red-900/60' : 'border-gray-100 dark:border-gray-700'}`}>
      <div className="flex justify-between items-start mb-2">
        <span className="font-medium text-gray-800 dark:text-gray-100 text-sm">{envelope.name}</span>
        <span className={`text-sm font-semibold ${over ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
          ${Math.abs(remaining).toFixed(2)}{over ? ' over' : ' left'}
        </span>
      </div>
      <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 mb-1">
        <div
          className={`h-2 rounded-full ${over ? 'bg-red-400' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
        <span>${spent.toFixed(2)} spent</span>
        <span>${total.toFixed(2)} budgeted</span>
      </div>
    </div>
  );
}
