import { useState, useEffect } from 'react';
import { api } from '../api';
import DebtCard from '../components/DebtCard';
import PayoffChart from '../components/PayoffChart';

export default function DebtPlanner() {
  const [debts, setDebts] = useState([]);
  const [projection, setProjection] = useState(null);
  const [extraPayment, setExtraPayment] = useState(0);
  const [method, setMethod] = useState('avalanche');
  const [loading, setLoading] = useState(true);
  const [projLoading, setProjLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newDebt, setNewDebt] = useState({ name: '', balance: '', apr: '', credit_limit: '', minimum_payment: '', due_day: '' });

  useEffect(() => {
    api.get('/debts').then(setDebts).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!debts.length) return;
    setProjLoading(true);
    api.get(`/debts/projection?extraPayment=${extraPayment}&method=${method}`)
      .then(setProjection)
      .finally(() => setProjLoading(false));
  }, [debts, extraPayment, method]);

  async function createDebt() {
    const saved = await api.post('/debts', {
      ...newDebt,
      balance: parseFloat(newDebt.balance) || 0,
      apr: parseFloat(newDebt.apr) || 0,
      credit_limit: parseFloat(newDebt.credit_limit) || 0,
      minimum_payment: parseFloat(newDebt.minimum_payment) || 0,
      due_day: newDebt.due_day ? parseInt(newDebt.due_day) : null,
    });
    setDebts(ds => [...ds, saved]);
    setShowNewForm(false);
    setNewDebt({ name: '', balance: '', apr: '', credit_limit: '', minimum_payment: '', due_day: '' });
  }

  async function deleteDebt(id) {
    if (!confirm('Remove this debt?')) return;
    await api.delete(`/debts/${id}`);
    setDebts(ds => ds.filter(d => d.id !== id));
  }

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Debt Planner</h1>
        <button onClick={() => setShowNewForm(true)} className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-700">
          + Add Debt
        </button>
      </div>

      {showNewForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">New Debt</h3>
          <div className="grid grid-cols-2 gap-3">
            {[['Name','name','text'],['Balance','balance','number'],['APR %','apr','number'],
              ['Credit Limit','credit_limit','number'],['Min Payment','minimum_payment','number'],['Due Day','due_day','number']
            ].map(([label, field, type]) => (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
                <input type={type} value={newDebt[field]} onChange={e => setNewDebt(d => ({ ...d, [field]: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNewForm(false)} className="text-sm border border-gray-200 dark:border-gray-600 rounded px-3 py-1 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={createDebt} className="bg-indigo-600 text-white text-sm px-3 py-1 rounded">Save</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-gray-400 dark:text-gray-500">Loading...</p> : (
        <div className="space-y-3">
          {debts.map(d => (
            <DebtCard
              key={d.id}
              debt={d}
              onUpdate={updated => setDebts(ds => ds.map(x => x.id === updated.id ? updated : x))}
              onDelete={deleteDebt}
            />
          ))}
          {debts.length > 0 && (
            <div className="text-right text-sm font-semibold text-red-600 dark:text-red-400">
              Total: ${totalDebt.toFixed(2)}
            </div>
          )}
        </div>
      )}

      {debts.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Payoff Projection</h2>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Extra monthly payment</label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-500 dark:text-gray-400">$</span>
                <input type="range" min="0" max="500" step="25" value={extraPayment}
                  onChange={e => setExtraPayment(+e.target.value)} className="w-36" />
                <span className="text-sm font-semibold w-12 text-gray-800 dark:text-gray-100">${extraPayment}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Method</label>
              <div className="flex gap-2">
                {['avalanche','snowball'].map(m => (
                  <button key={m} onClick={() => setMethod(m)}
                    className={`text-sm px-3 py-1 rounded border capitalize ${method === m ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {projLoading ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm">Calculating...</p>
          ) : projection && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Payoff date</p>
                  <p className="font-bold text-gray-800 dark:text-gray-100">{projection.payoffDate}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Months remaining</p>
                  <p className="font-bold text-gray-800 dark:text-gray-100">{projection.months.length}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total interest</p>
                  <p className="font-bold text-red-600 dark:text-red-400">${projection.totalInterest.toFixed(2)}</p>
                </div>
              </div>
              <PayoffChart months={projection.months} debts={debts} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
