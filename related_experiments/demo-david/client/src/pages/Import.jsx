import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import CsvMapper from '../components/CsvMapper';

const STEPS = { upload: 'upload', map: 'map', categorize: 'categorize', done: 'done' };

export default function Import() {
  const [step, setStep] = useState(STEPS.upload);
  const [file, setFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [assignments, setAssignments] = useState({});
  const [autoSuggested, setAutoSuggested] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/categories'), api.get('/accounts')])
      .then(([cats, accs]) => { setCategories(cats); setAccounts(accs); });
  }, []);

  async function handleParse() {
    if (!file) return;
    setError(''); setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api.upload('/import/parse', form);
      setParseResult(data);
      setStep(STEPS.map);
    } catch (e) {
      setError(e.error || e.message || 'Parse failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMappingConfirmed(m) {
    setMapping(m);
    try {
      const descriptions = [...new Set(
        parseResult.rows.map(r => r[m.description]?.trim() ?? '').filter(Boolean)
      )];
      const { suggestions } = await api.post('/import/suggest', { descriptions });
      setAssignments(suggestions);
      setAutoSuggested(suggestions);
    } catch {
      // Suggestions are optional; continue to the categorize step without them.
    }
    setStep(STEPS.categorize);
  }

  async function handleConfirm() {
    setError(''); setLoading(true);
    try {
      const assignList = [];
      parseResult.rows.forEach((row, index) => {
        const desc = row[mapping.description]?.trim() ?? '';
        const catId = assignments[desc];
        if (catId) assignList.push({ index, category_id: parseInt(catId) });
      });

      const data = await api.post('/import/confirm', {
        rows: parseResult.rows,
        mapping,
        account_id: selectedAccount ? parseInt(selectedAccount) : null,
        assignments: assignList,
      });
      setResult(data);
      setStep(STEPS.done);
    } catch (e) {
      setError(e.error || e.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep(STEPS.upload); setFile(null); setParseResult(null);
    setMapping(null); setAssignments({}); setAutoSuggested({}); setResult(null); setError('');
  }

  const groupedRows = (parseResult?.rows && mapping)
    ? parseResult.rows.reduce((acc, row) => {
        const desc = row[mapping.description]?.trim() ?? '';
        if (!acc[desc]) acc[desc] = [];
        acc[desc].push(row);
        return acc;
      }, {})
    : {};

  const selectCls = "border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Import Transactions</h1>

      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded">{error}</div>}

      {step === STEPS.upload && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Upload a CSV exported from your bank.</p>
          <div>
            <label htmlFor="csv-acc" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Account (optional)</label>
            <select id="csv-acc" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
              className={`${selectCls} w-full max-w-xs`}>
              <option value="">— select account —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <input type="file" accept=".csv" onChange={e => setFile(e.target.files[0])}
            className="text-sm text-gray-600 dark:text-gray-300" />
          <button onClick={handleParse} disabled={!file || loading}
            className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50">
            {loading ? 'Parsing...' : 'Upload & Parse'}
          </button>
        </div>
      )}

      {step === STEPS.map && parseResult && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Map Columns</h2>
          <CsvMapper
            headers={parseResult.headers}
            preview={parseResult.preview}
            onConfirm={handleMappingConfirmed}
          />
        </div>
      )}

      {step === STEPS.categorize && mapping && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Assign Categories</h2>
            <Link to="/rules" className="text-xs text-indigo-400 hover:text-indigo-300">Manage rules →</Link>
          </div>
          {(() => {
            const autoCount = Object.keys(autoSuggested).length;
            const total = Object.keys(groupedRows).length;
            return autoCount > 0
              ? <p className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded">{autoCount} of {total} groups auto-categorized from your transaction history. Review and adjust as needed.</p>
              : <p className="text-xs text-gray-500 dark:text-gray-400">Transactions are grouped by description. Assign a category to each group.</p>;
          })()}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {Object.entries(groupedRows).map(([desc, rows]) => (
              <div key={desc} className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{desc || '(no description)'}</p>
                    {autoSuggested[desc] && assignments[desc] === autoSuggested[desc] && (
                      <span className="shrink-0 text-[10px] font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">auto</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{rows.length} transaction{rows.length > 1 ? 's' : ''}</p>
                </div>
                <select
                  value={assignments[desc] ?? ''}
                  onChange={e => setAssignments(a => ({ ...a, [desc]: e.target.value }))}
                  className={`${selectCls} shrink-0 w-40`}
                >
                  <option value="">Uncategorized</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(STEPS.map)} className="text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700">
              Back
            </button>
            <button onClick={handleConfirm} disabled={loading}
              className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50">
              {loading ? 'Importing...' : `Import ${parseResult.rows.length} transactions`}
            </button>
          </div>
        </div>
      )}

      {step === STEPS.done && result && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-3">
          <div className="text-emerald-600 dark:text-emerald-400 font-semibold">Import complete!</div>
          <p className="text-sm text-gray-700 dark:text-gray-200">{result.inserted} transactions imported · {result.duplicates} duplicates skipped</p>
          <button onClick={reset} className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700">
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
