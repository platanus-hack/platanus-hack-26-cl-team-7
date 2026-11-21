import { describe, it, expect } from 'vitest';
import { datePresetToRange } from './datePreset';

const NOW = new Date('2026-05-15');

describe('datePresetToRange', () => {
  it('all_time returns empty object', () => {
    expect(datePresetToRange('all_time', '', '', NOW)).toEqual({});
  });

  it('unknown preset returns empty object', () => {
    expect(datePresetToRange('bogus', '', '', NOW)).toEqual({});
  });

  it('this_month returns first and last day of current month', () => {
    expect(datePresetToRange('this_month', '', '', NOW)).toEqual({
      start: '2026-05-01',
      end: '2026-05-31',
    });
  });

  it('last_month returns first and last day of previous month', () => {
    expect(datePresetToRange('last_month', '', '', NOW)).toEqual({
      start: '2026-04-01',
      end: '2026-04-30',
    });
  });

  it('last_month in January wraps to December of prior year', () => {
    expect(datePresetToRange('last_month', '', '', new Date('2026-01-15'))).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
  });

  it('last_3_months returns same day 3 months ago to today', () => {
    expect(datePresetToRange('last_3_months', '', '', NOW)).toEqual({
      start: '2026-02-15',
      end: '2026-05-15',
    });
  });

  it('last_6_months returns same day 6 months ago to today', () => {
    expect(datePresetToRange('last_6_months', '', '', NOW)).toEqual({
      start: '2025-11-15',
      end: '2026-05-15',
    });
  });

  it('this_year returns Jan 1 to Dec 31 of current year', () => {
    expect(datePresetToRange('this_year', '', '', NOW)).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });

  it('custom passes through customStart and customEnd', () => {
    expect(datePresetToRange('custom', '2026-03-01', '2026-03-31', NOW)).toEqual({
      start: '2026-03-01',
      end: '2026-03-31',
    });
  });

  it('last_3_months clamps correctly when now is on the 31st', () => {
    const may31 = new Date('2026-05-31');
    const result = datePresetToRange('last_3_months', '', '', may31);
    // Feb 31 doesn't exist; should clamp to Feb 28
    expect(result.start).toBe('2026-02-28');
    expect(result.end).toBe('2026-05-31');
  });

  it('custom with empty start/end returns empty object', () => {
    expect(datePresetToRange('custom', '', '', NOW)).toEqual({});
  });
});
