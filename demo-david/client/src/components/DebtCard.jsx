import { useState } from 'react';
import { api } from '../api';

export default function DebtCard({ debt, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...debt });

  function set(f) { return e => setForm(d => ({ ...d, [f]: e.target.value })); }

  async function save() {
    const saved = await api.put(`/debts/${debt.id}`, {
      ...form,
      balance: parseFloat(form.balance),
      apr: parseFloat(form.apr),
      credit_limit: parseFloat(form.credit_limit),
      minimum_payment: parseFloat(form.minimum_payment),
      due_day: form.due_day ? parseInt(form.due_day) : null,
    });
    onUpdate(saved);
    setEditing(false);
  }

  const utilization = debt.credit_limit > 0 ? (debt.balance / debt.credit_limit * 100).toFixed(0) : null;

  if (editing) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {[['Name','name','text'],['Balance','balance','number'],['APR %','apr','number'],
            ['Credit Limit','credit_limit','number'],['Min Payment','minimum_payment','number'],['Due Day','due_day','number']
          ].map(([label, field, type]) => (
            <div key={field}>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
              <input type={type} value={form[field] ?? ''} onChange={set(field)}
                className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setEditing(false)} className="text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-1 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button onClick={save} className="bg-indigo-600 text-white text-sm px-3 py-1 rounded">Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{debt.name}</h3>
          {debt.due_day && <p className="text-xs text-gray-400 dark:text-gray-500">Due day {debt.due_day} of month</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200">Edit</button>
          <button onClick={() => onDelete(debt.id)} className="text-xs text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400">Delete</button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><p className="text-xs text-gray-400 dark:text-gray-500">Balance</p><p className="font-bold text-red-600 dark:text-red-400">${debt.balance.toFixed(2)}</p></div>
        <div><p className="text-xs text-gray-400 dark:text-gray-500">APR</p><p className="font-semibold text-gray-800 dark:text-gray-100">{debt.apr}%</p></div>
        <div><p className="text-xs text-gray-400 dark:text-gray-500">Min Payment</p><p className="font-semibold text-gray-800 dark:text-gray-100">${debt.minimum_payment.toFixed(2)}</p></div>
        {utilization && <div><p className="text-xs text-gray-400 dark:text-gray-500">Utilization</p><p className={`font-semibold ${+utilization > 30 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{utilization}%</p></div>}
      </div>
    </div>
  );
}
