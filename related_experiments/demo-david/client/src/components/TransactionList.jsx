export default function TransactionList({ transactions, onEdit, onDelete }) {
  if (!transactions.length) {
    return <p className="text-gray-400 dark:text-gray-500 text-sm py-4 text-center">No transactions.</p>;
  }
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700">
      {transactions.map(tx => (
        <div key={tx.id} className="flex items-center justify-between py-3 gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{tx.description}</span>
              {tx.is_recurring === 1 && (
                <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 rounded">Recurring</span>
              )}
              {tx.has_splits === 1 && (
                <span className="text-xs bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-1.5 rounded">Split</span>
              )}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {tx.date} · {tx.has_splits === 1 ? 'Split' : (tx.category_name || 'Uncategorized')} · {tx.account_name || '—'}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`font-semibold text-sm ${tx.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {tx.amount > 0 ? '+' : '-'}${Math.abs(tx.amount).toFixed(2)}
            </span>
            <button onClick={() => onEdit(tx)} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Edit</button>
            <button onClick={() => onDelete(tx.id)} className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400">Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
