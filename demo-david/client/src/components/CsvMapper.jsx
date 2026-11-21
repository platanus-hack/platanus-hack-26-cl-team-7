import { useState } from 'react';

export default function CsvMapper({ headers, preview, onConfirm }) {
  const [mapping, setMapping] = useState({
    date: headers[0] ?? '',
    amount: headers[1] ?? '',
    description: headers[2] ?? '',
  });

  function set(field) {
    return e => setMapping(m => ({ ...m, [field]: e.target.value }));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">Map your CSV columns to the required fields.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {['date', 'amount', 'description'].map(field => (
          <div key={field}>
            <label htmlFor={`map-${field}`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 capitalize">
              {field} column
            </label>
            <select id={`map-${field}`} value={mapping[field]} onChange={set(field)}
              className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
              <option value="">— select —</option>
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* Preview table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-gray-600 dark:text-gray-300 border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50">
              {headers.map(h => <th key={h} className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-left">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i}>
                {headers.map(h => <td key={h} className="border border-gray-200 dark:border-gray-700 px-2 py-1">{row[h]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => onConfirm(mapping)}
        disabled={!mapping.date || !mapping.amount || !mapping.description}
        className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
      >
        Confirm mapping
      </button>
    </div>
  );
}
