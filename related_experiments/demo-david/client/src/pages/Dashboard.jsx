import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import EnvelopeCard from '../components/EnvelopeCard';
import EnvelopeDetail from '../components/EnvelopeDetail';
import SummaryModal from '../components/SummaryModal';

function MonthNav({ year, month, onChange }) {
  function prev() {
    if (month === 1) onChange(year - 1, 12);
    else onChange(year, month - 1);
  }
  function next() {
    if (month === 12) onChange(year + 1, 1);
    else onChange(year, month + 1);
  }
  const label = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  return (
    <div className="flex items-center gap-3">
      <button onClick={prev} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">‹</button>
      <span className="font-semibold text-gray-800 dark:text-gray-100">{label}</span>
      <button onClick={next} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">›</button>
    </div>
  );
}

export default function Dashboard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [envelopes, setEnvelopes] = useState([]);
  const [debts, setDebts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [goals, setGoals] = useState([]);
  const [filterAccount, setFilterAccount] = useState('all');
  const [selectedEnvelope, setSelectedEnvelope] = useState(null);
  const [summaryModal, setSummaryModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [asOfDate, setAsOfDate] = useState(null);

  useEffect(() => {
    api.get('/accounts').then(setAccounts);
    api.get('/debts').then(setDebts);
    api.get('/transactions/latest-date').then(r => setAsOfDate(r.date));
    api.get('/investments').then(setInvestments).catch(() => {});
    api.get('/goals').then(setGoals).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = filterAccount !== 'all' ? `?account_id=${filterAccount}` : '';
    api.get(`/budget/${year}/${month}${qs}`)
      .then(setEnvelopes)
      .finally(() => setLoading(false));
  }, [year, month, filterAccount]);

  const expenses = envelopes.filter(e => e.type === 'expense');
  const income = envelopes.filter(e => e.type === 'income');
  const totalSpent = expenses.reduce((s, e) => s + Math.max(0, -e.spent), 0);
  const totalBudgeted = expenses.reduce((s, e) => s + e.allocated + e.rolled_over, 0);
  const totalEarned = income.reduce((s, e) => s + e.spent, 0);
  const net = totalEarned - totalSpent;
  const effectiveBal = d => d.live_balance ?? d.balance;
  const totalDebt = debts.reduce((s, d) => s + effectiveBal(d), 0);
  const totalInterest = debts.reduce((s, d) => s + effectiveBal(d) * (d.apr / 100 / 12), 0);
  const totalPaidThisMonth = debts.reduce((s, d) => s + (d.paid_this_month ?? 0), 0);

  const totalInvested = investments.reduce((s, h) => s + h.shares * h.purchase_price, 0);
  const totalInvestmentValue = investments.reduce((s, h) => {
    const price = h.price?.current;
    return s + (price != null ? h.shares * price : h.shares * h.purchase_price);
  }, 0);
  const totalInvestmentGain = totalInvestmentValue - totalInvested;
  const totalInvestmentPct = totalInvested > 0 ? (totalInvestmentGain / totalInvested) * 100 : 0;
  const activeGoals = goals.filter(g => !g.completed_at).slice(0, 5);
  const displayBalance = accounts.length === 0
    ? null
    : filterAccount === 'all'
      ? accounts.reduce((s, a) => s + (a.current_balance ?? a.balance), 0)
      : (accounts.find(a => a.id === parseInt(filterAccount))?.current_balance ?? null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          {asOfDate && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">as of {asOfDate}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <div className="flex items-center gap-2">
            <select
              value={filterAccount}
              onChange={e => setFilterAccount(e.target.value)}
              className="border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
            >
              <option value="all">All accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {displayBalance !== null && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                <span className={`font-semibold ${displayBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  ${displayBalance.toFixed(2)}
                </span>
              </span>
            )}
          </div>
          <MonthNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <button onClick={() => setSummaryModal('budgeted')} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 text-left hover:ring-2 hover:ring-indigo-400 transition-shadow">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Budgeted</p>
          <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">${totalBudgeted.toFixed(2)}</p>
        </button>
        <button onClick={() => setSummaryModal('earned')} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 text-left hover:ring-2 hover:ring-emerald-400 transition-shadow">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Earned</p>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">${totalEarned.toFixed(2)}</p>
        </button>
        <button onClick={() => setSummaryModal('spent')} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 text-left hover:ring-2 hover:ring-gray-400 transition-shadow">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Spent</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">${totalSpent.toFixed(2)}</p>
        </button>
        <button onClick={() => setSummaryModal('net')} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 text-left hover:ring-2 hover:ring-gray-400 transition-shadow">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Net</p>
          <p className={`text-xl font-bold ${net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {net >= 0 ? '+' : ''}${net.toFixed(2)}
          </p>
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 dark:text-gray-500">Loading...</p>
      ) : (
        <>
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Envelopes</h2>
              <Link to="/envelopes" className="text-xs text-indigo-400 hover:text-indigo-300">Manage Envelopes →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {expenses.map(e => (
                <EnvelopeCard
                  key={e.id}
                  envelope={e}
                  onClick={() => setSelectedEnvelope(e)}
                />
              ))}
            </div>
          </section>

          {debts.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Debts</h2>
                <Link to="/debt" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</Link>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 space-y-2">
                <div className="grid grid-cols-4 gap-2 text-xs text-gray-400 dark:text-gray-500 pb-1 border-b border-gray-50 dark:border-gray-700">
                  <span>Name</span>
                  <span className="text-right">Balance</span>
                  <span className="text-right">Interest</span>
                  <span className="text-right">Paid this month</span>
                </div>
                {debts.map(d => {
                  const bal = effectiveBal(d);
                  const interest = bal * (d.apr / 100 / 12);
                  return (
                    <div key={d.id} className="grid grid-cols-4 gap-2 text-sm items-center">
                      <span className="text-gray-700 dark:text-gray-200 truncate">{d.name}</span>
                      <span className="text-right font-semibold text-red-600 dark:text-red-400">${bal.toFixed(2)}</span>
                      <span className="text-right text-amber-600 dark:text-amber-400">+${interest.toFixed(2)}</span>
                      <span className={`text-right font-medium ${(d.paid_this_month ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                        {(d.paid_this_month ?? 0) > 0 ? `$${d.paid_this_month.toFixed(2)}` : '—'}
                      </span>
                    </div>
                  );
                })}
                <div className="border-t dark:border-gray-700 pt-2 grid grid-cols-4 gap-2 text-sm font-semibold">
                  <span className="text-gray-900 dark:text-white">Total</span>
                  <span className="text-right text-red-600 dark:text-red-400">${totalDebt.toFixed(2)}</span>
                  <span className="text-right text-amber-600 dark:text-amber-400">+${totalInterest.toFixed(2)}</span>
                  <span className={`text-right ${totalPaidThisMonth > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    {totalPaidThisMonth > 0 ? `$${totalPaidThisMonth.toFixed(2)}` : '—'}
                  </span>
                </div>
              </div>
            </section>
          )}

          {investments.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Investments</h2>
                <a href="/investments" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</a>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                {/* Portfolio totals */}
                <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700 px-4 py-3">
                  <div className="pr-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Invested</p>
                    <p className="font-semibold text-gray-800 dark:text-gray-100">${totalInvested.toFixed(2)}</p>
                  </div>
                  <div className="px-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Value</p>
                    <p className="font-semibold text-gray-800 dark:text-gray-100">${totalInvestmentValue.toFixed(2)}</p>
                  </div>
                  <div className="pl-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Return</p>
                    <p className={`font-semibold ${totalInvestmentGain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {totalInvestmentGain >= 0 ? '+' : ''}${Math.abs(totalInvestmentGain).toFixed(2)}
                      <span className="text-xs font-normal ml-1">({totalInvestmentPct >= 0 ? '+' : ''}{totalInvestmentPct.toFixed(1)}%)</span>
                    </p>
                  </div>
                </div>
                {/* Per-holding rows */}
                <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700/50 px-4">
                  {investments.map(h => {
                    const current = h.price?.current;
                    const costBasis = h.shares * h.purchase_price;
                    const currentVal = current != null ? h.shares * current : null;
                    const gain = currentVal != null ? currentVal - costBasis : null;
                    const pct = gain != null && costBasis > 0 ? (gain / costBasis) * 100 : null;
                    return (
                      <div key={h.id} className="flex items-center justify-between py-2.5 text-sm">
                        <div>
                          <span className="font-medium text-gray-800 dark:text-gray-100">{h.ticker}</span>
                          <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">{h.shares} sh</span>
                          {h.notes && <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">· {h.notes}</span>}
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-gray-800 dark:text-gray-100">
                            {current != null ? `$${current.toFixed(4)}` : <span className="text-gray-400">—</span>}
                          </span>
                          {gain != null && pct != null && (
                            <span className={`ml-2 text-xs ${gain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              {gain >= 0 ? '+' : ''}{pct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {activeGoals.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Savings Goals</h2>
                <a href="/goals" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</a>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
                {activeGoals.map(g => {
                  const balance = g.account_balance ?? 0;
                  const pct = g.target_amount > 0 ? Math.min(100, balance / g.target_amount * 100) : 0;
                  const reached = balance >= g.target_amount;
                  return (
                    <div key={g.id} className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 dark:text-gray-200 w-32 truncate">{g.name}</span>
                      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${reached ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-xs w-8 text-right ${reached ? 'text-emerald-500' : 'text-gray-400 dark:text-gray-500'}`}>
                        {reached ? '✓' : `${Math.round(pct)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {selectedEnvelope && (
        <EnvelopeDetail
          envelope={selectedEnvelope}
          accountId={filterAccount !== 'all' ? filterAccount : null}
          year={year}
          month={month}
          onClose={() => setSelectedEnvelope(null)}
        />
      )}

      {summaryModal && (
        <SummaryModal
          type={summaryModal}
          expenses={expenses}
          income={income}
          onClose={() => setSummaryModal(null)}
        />
      )}
    </div>
  );
}
