import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '../ThemeContext';

export default function PayoffChart({ months, debts }) {
  const dark = Boolean(useTheme()?.dark);
  if (!months?.length) return null;

  const step = Math.max(1, Math.floor(months.length / 60));
  const data = months
    .filter((_, i) => i % step === 0 || i === months.length - 1)
    .map(m => {
      const point = { month: m.month };
      for (const d of debts) {
        point[d.name] = m.balances[d.id] ?? 0;
      }
      return point;
    });

  const colors = ['#6366f1', '#f59e0b', '#10b981', '#ef4444'];

  // Recharts draws with inline colours, so the axes, grid and tooltip follow the theme here.
  const axis = { fontSize: 11, fill: dark ? '#9ca3af' : '#6b7280' };
  const grid = dark ? '#374151' : '#e5e7eb';
  const tooltipStyle = dark
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#f3f4f6' }
    : { backgroundColor: '#ffffff', border: '1px solid #e5e7eb', color: '#111827' };

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} />
        <XAxis dataKey="month" tick={axis} label={{ value: 'Months', position: 'insideBottom', offset: -2, fill: axis.fill, fontSize: 11 }} />
        <YAxis tick={axis} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
        <Tooltip formatter={(v) => [`$${v.toFixed(2)}`, '']} contentStyle={tooltipStyle} labelStyle={{ color: tooltipStyle.color }} />
        <Legend />
        {debts.map((d, i) => (
          <Line key={d.id} type="monotone" dataKey={d.name} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
