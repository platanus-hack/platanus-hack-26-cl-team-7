import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../api';

const RANGES = [
  { label: '1D', value: '1d' },
  { label: '1W', value: '5d' },
  { label: '1M', value: '1mo' },
  { label: '1Y', value: '1y' },
  { label: 'All', value: 'max' },
];

function fmt(n, decimals = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function fmtDateTime(ms, range) {
  if (range === '1d') {
    return new Date(ms).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
  }
  if (range === '5d') {
    return new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return fmtDate(ms);
}

function GainBadge({ value, pct }) {
  const up = value >= 0;
  const cls = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <span className={`font-semibold ${cls}`}>
      {up ? '+' : ''}${fmt(Math.abs(value))} ({up ? '+' : ''}{fmt(pct, 1)}%)
    </span>
  );
}

function ChartTooltip({ active, payload, label, shares, range }) {
  if (!active || !payload?.length) return null;
  const price = payload[0]?.value;
  return (
    <div className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2">
      <p className="text-gray-500 dark:text-gray-400 mb-1">{fmtDateTime(label, range)}</p>
      <p className="flex justify-between gap-6"><span>Price</span><span>${price?.toFixed(4)}/sh</span></p>
      {shares != null && <p className="flex justify-between gap-6"><span>Total</span><span>${fmt(shares * price)}</span></p>}
    </div>
  );
}

function StockChart({ ticker, shares, purchasePrice, range, onRangeChange }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError('');
    api.get(`/investments/history/${encodeURIComponent(ticker)}?range=${range}`)
      .then(d => { setHistory(d); setLoading(false); })
      .catch(e => { setError(e.message || 'Failed to load chart'); setLoading(false); });
  }, [ticker, range]);

  const points = history?.points ?? [];
  const first = points[0]?.price;
  const last = points[points.length - 1]?.price;
  const up = last != null && first != null ? last >= first : true;
  const color = up ? '#34d399' : '#f87171';

  return (
    <div className="space-y-3">
      {/* Range selector */}
      <div className="flex items-center gap-1">
        {RANGES.map(r => (
          <button
            key={r.value}
            onClick={() => onRangeChange(r.value)}
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              range === r.value
                ? 'bg-indigo-600 text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading && <div className="h-48 flex items-center justify-center text-gray-500 text-sm">Loading chart…</div>}
      {error && <div className="h-48 flex items-center justify-center text-red-600 dark:text-red-400 text-sm">{error}</div>}

      {!loading && !error && points.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              scale="time"
              tickFormatter={t => fmtDateTime(t, range)}
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              minTickGap={60}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `$${v.toFixed(2)}`}
              width={56}
            />
            <Tooltip content={<ChartTooltip shares={shares} range={range} />} />
            {purchasePrice && (
              <ReferenceLine
                y={purchasePrice}
                stroke="#6366f1"
                strokeDasharray="4 3"
                label={{ value: 'cost', fontSize: 10, fill: '#818cf8', position: 'insideTopRight' }}
              />
            )}
            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              strokeWidth={2}
              fill="url(#chartFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
      {!loading && !error && points.length === 0 && (
        <div className="h-48 flex items-center justify-center text-gray-500 text-sm">No chart data available</div>
      )}
    </div>
  );
}

function HoldingForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial ?? {
    ticker: '', shares: '', purchase_price: '', purchase_date: '', notes: '',
  });
  const set = f => e => setForm(d => ({ ...d, [f]: e.target.value }));
  const inputCls = "w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500";

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2 sm:col-span-1">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ticker <span className="text-gray-500">(e.g. YES.V)</span></label>
        <input value={form.ticker} onChange={set('ticker')} placeholder="YES.V" className={`${inputCls} uppercase`} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Shares</label>
        <input type="number" step="any" value={form.shares} onChange={set('shares')} placeholder="1000" className={inputCls} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Price per share ($)</label>
        <input type="number" step="any" value={form.purchase_price} onChange={set('purchase_price')} placeholder="0.50" className={inputCls} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Purchase date</label>
        <input type="date" value={form.purchase_date} onChange={set('purchase_date')} className={inputCls} />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes <span className="text-gray-500">(optional)</span></label>
        <input value={form.notes} onChange={set('notes')} placeholder="e.g. TFSA purchase" className={inputCls} />
      </div>
      <div className="col-span-2 flex gap-2 justify-end">
        <button onClick={onCancel} className="text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
        <button onClick={() => onSave(form)} className="text-sm bg-indigo-600 text-white rounded px-3 py-1.5 hover:bg-indigo-700">Save</button>
      </div>
    </div>
  );
}

export default function Investments() {
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [range, setRange] = useState('1mo');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/investments').then(data => {
      setHoldings(data);
      if (data.length) setSelectedTicker(current => current || data[0].ticker);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(form) {
    if (editingId) {
      const updated = await api.put(`/investments/${editingId}`, form);
      setHoldings(h => h.map(x => x.id === editingId ? { ...x, ...updated } : x));
      setEditingId(null);
    } else {
      await api.post('/investments', form);
      load();
      setShowForm(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this holding?')) return;
    await api.delete(`/investments/${id}`);
    setHoldings(h => {
      const next = h.filter(x => x.id !== id);
      if (selectedTicker === h.find(x => x.id === id)?.ticker && next.length) {
        setSelectedTicker(next[0].ticker);
      }
      return next;
    });
  }

  const totalCost = holdings.reduce((s, h) => s + h.shares * h.purchase_price, 0);
  const totalValue = holdings.reduce((s, h) => {
    const price = h.price?.current;
    return s + (price != null ? h.shares * price : h.shares * h.purchase_price);
  }, 0);
  const totalGain = totalValue - totalCost;
  const totalPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  // Cost basis for the selected ticker (weighted avg across all lots)
  const selectedHoldings = holdings.filter(h => h.ticker === selectedTicker);
  const selectedShares = selectedHoldings.reduce((s, h) => s + h.shares, 0);
  const selectedCost = selectedHoldings.reduce((s, h) => s + h.shares * h.purchase_price, 0);
  const selectedAvgCost = selectedShares > 0 ? selectedCost / selectedShares : null;

  const tickers = [...new Set(holdings.map(h => h.ticker))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Investments</h1>
        <button onClick={() => { setShowForm(true); setEditingId(null); }}
          className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-700">
          + Add Holding
        </button>
      </div>

      {showForm && !editingId && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">New Holding</h3>
          <HoldingForm onSave={handleSave} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : holdings.length === 0 ? (
        <p className="text-gray-500 text-sm">No holdings yet. Add a stock to get started.</p>
      ) : (
        <>
          {/* Portfolio summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Invested</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">${fmt(totalCost)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Current Value</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">${fmt(totalValue)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Gain / Loss</p>
              <p className={`text-lg font-bold ${totalGain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {totalGain >= 0 ? '+' : ''}${fmt(Math.abs(totalGain))}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Return</p>
              <p className={`text-lg font-bold ${totalPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {totalPct >= 0 ? '+' : ''}{fmt(Math.abs(totalPct), 1)}%
              </p>
            </div>
          </div>

          {/* Holdings list */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
            {holdings.map(h => {
              const current = h.price?.current;
              const costBasis = h.shares * h.purchase_price;
              const currentVal = current != null ? h.shares * current : null;
              const gain = currentVal != null ? currentVal - costBasis : null;
              const pct = gain != null && costBasis > 0 ? (gain / costBasis) * 100 : null;
              const dayChange = current != null && h.price?.prev_close
                ? ((current - h.price.prev_close) / h.price.prev_close) * 100 : null;

              if (editingId === h.id) {
                return (
                  <div key={h.id} className="p-4">
                    <HoldingForm
                      initial={h}
                      onSave={handleSave}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                );
              }

              return (
                <div
                  key={h.id}
                  className={`p-4 cursor-pointer transition-colors ${selectedTicker === h.ticker ? 'bg-gray-100 dark:bg-gray-700/50' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
                  onClick={() => setSelectedTicker(h.ticker)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-900 dark:text-gray-100">{h.ticker}</span>
                        {dayChange != null && (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${dayChange >= 0 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'}`}>
                            {dayChange >= 0 ? '+' : ''}{fmt(dayChange, 2)}% today
                          </span>
                        )}
                        {h.notes && <span className="text-xs text-gray-500">{h.notes}</span>}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {fmt(h.shares, 4)} shares · bought {h.purchase_date} @ ${fmt(h.purchase_price, 4)}/sh · cost ${fmt(costBasis)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-lg">
                        {current != null ? `$${fmt(current, 4)}` : <span className="text-gray-500 text-sm">no price</span>}
                        <span className="text-xs text-gray-500 font-normal ml-1">/sh</span>
                      </p>
                      {currentVal != null && (
                        <p className="text-sm text-gray-700 dark:text-gray-300">${fmt(currentVal)} total</p>
                      )}
                      {gain != null && pct != null && (
                        <p className="text-xs mt-0.5">
                          <GainBadge value={gain} pct={pct} />
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3 mt-2 justify-end">
                    <button onClick={e => { e.stopPropagation(); setEditingId(h.id); setShowForm(false); }}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Edit</button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(h.id); }}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400">Delete</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chart section */}
          {selectedTicker && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  {tickers.length > 1 && (
                    <select
                      value={selectedTicker}
                      onChange={e => setSelectedTicker(e.target.value)}
                      className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      {tickers.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100">{selectedTicker}</h2>
                  {selectedAvgCost != null && (
                    <span className="text-xs text-gray-500">avg cost ${fmt(selectedAvgCost, 4)}/sh · dashed line on chart</span>
                  )}
                </div>
              </div>
              <StockChart
                ticker={selectedTicker}
                shares={selectedShares}
                purchasePrice={selectedAvgCost}
                range={range}
                onRangeChange={setRange}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
