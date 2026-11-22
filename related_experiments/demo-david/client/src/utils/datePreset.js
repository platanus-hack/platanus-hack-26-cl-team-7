export function datePresetToRange(preset, customStart = '', customEnd = '', now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  const today = fmt(now);

  const monthsAgo = n => {
    const d = new Date(now);
    const targetMonth = d.getUTCMonth() - n;
    d.setUTCMonth(targetMonth);
    // If day overflowed (e.g., May 31 - 3 months → Feb 31 → Mar 3), clamp back
    const expectedMonth = ((targetMonth % 12) + 12) % 12;
    if (d.getUTCMonth() !== expectedMonth) {
      d.setUTCDate(0); // go to last day of previous month (which is the intended month)
    }
    return fmt(d);
  };

  const firstOfMonth = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
  const lastOfMonth  = d => {
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return fmt(lastDay);
  };

  switch (preset) {
    case 'all_time':
      return {};
    case 'this_month':
      return { start: firstOfMonth(now), end: lastOfMonth(now) };
    case 'last_month': {
      const prev = new Date(now);
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      return { start: firstOfMonth(prev), end: lastOfMonth(prev) };
    }
    case 'last_3_months':
      return { start: monthsAgo(3), end: today };
    case 'last_6_months':
      return { start: monthsAgo(6), end: today };
    case 'this_year':
      return { start: `${now.getUTCFullYear()}-01-01`, end: `${now.getUTCFullYear()}-12-31` };
    case 'custom':
      if (!customStart || !customEnd) return {};
      return { start: customStart, end: customEnd };
    default:
      return {};
  }
}
