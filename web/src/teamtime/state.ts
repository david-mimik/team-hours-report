// The view's state, kept in the address (#period=…&people=…) so a copied link opens the same view.
import { monthEnd, presets, type Data, type Gran, type Range } from './model';
import type { Sort } from './ui';

export type State = {
  view: 'time' | 'hours';
  period: string;
  from: string;
  to: string;
  ym: string;
  people: string[] | null; // null = everyone shown
  former: boolean;
  teamOnly: boolean;
  cmp: boolean;
  tgran: 'auto' | Gran;
  group: 'person' | 'phase';
  sortT: Sort;
  sortH: Sort;
  hcols: 'month' | 'week';
  format: 'dec' | 'hm';
  forecast: boolean; // Hours: forecast of the next 3 weeks (off by default, remembered in this browser)
};

const FC_KEY = 'tt-hours-forecast';
const storedForecast = () => { try { return localStorage.getItem(FC_KEY) === '1'; } catch { return false; } };
export const rememberForecast = (on: boolean) => { try { localStorage.setItem(FC_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } };

export function initialState(today: string): State {
  return {
    view: 'hours', period: 'months', from: today.slice(0, 8) + '01', to: today, ym: today.slice(0, 7), people: null, former: false,
    teamOnly: false, cmp: true, tgran: 'auto', group: 'person', sortT: { k: 'name', d: 1 }, sortH: { k: 'name', d: 1 }, hcols: 'week', format: 'dec',
    forecast: storedForecast(),
  };
}

const sortOf = (v: string | null, def: Sort): Sort => {
  const [k, d] = (v || '').split('.');
  return (k === 'name' || k === 'hours') && (d === '1' || d === '-1') ? { k, d: +d as 1 | -1 } : def;
};

export function fromHash(hash: string, today: string): State {
  const s = initialState(today), h = new URLSearchParams(hash.replace(/^#/, ''));
  const g = (k: string) => h.get(k);
  if (g('view') === 'time') s.view = 'time';
  if (g('period')) s.period = g('period')!;
  if (g('from')) s.from = g('from')!;
  if (g('to')) s.to = g('to')!;
  if (g('ym')) s.ym = g('ym')!;
  if (g('people')) s.people = g('people')!.split(',');
  s.former = g('former') === '1';
  s.teamOnly = g('team') === '1';
  s.cmp = g('compare') !== 'off';
  if (['sprint', 'week', 'month'].includes(g('tcols') || '')) s.tgran = g('tcols') as Gran;
  if (g('group') === 'phase') s.group = 'phase';
  s.sortT = sortOf(g('sortT'), s.sortT);
  s.sortH = sortOf(g('sortH'), s.sortH);
  if (g('hcols') === 'month') s.hcols = 'month';
  if (g('forecast') === '1') s.forecast = true;
  if (g('format') === 'hm') s.format = 'hm';
  return s;
}

export function toHash(s: State) {
  const h = new URLSearchParams({ view: s.view, period: s.period });
  if (s.period === 'custom') { h.set('from', s.from); h.set('to', s.to); }
  if (s.period === 'month') h.set('ym', s.ym);
  if (s.people) h.set('people', s.people.join(','));
  if (s.former) h.set('former', '1');
  if (s.teamOnly) h.set('team', '1');
  if (!s.cmp) h.set('compare', 'off');
  if (s.tgran !== 'auto') h.set('tcols', s.tgran);
  if (s.group !== 'person') h.set('group', s.group);
  h.set('sortT', s.sortT.k + '.' + s.sortT.d);
  h.set('sortH', s.sortH.k + '.' + s.sortH.d);
  if (s.hcols !== 'week') h.set('hcols', s.hcols);
  if (s.view === 'hours' && s.forecast) h.set('forecast', '1');
  if (s.format !== 'dec') h.set('format', s.format);
  return '#' + h.toString();
}

// One date range drives every view; each view only chooses how to group it.
export function rangeOf(s: State, d: Data, today: string): Range {
  if (s.period === 'month') {
    const last = monthEnd(s.ym);
    return { p: 'month', a: s.ym + '-01', b: last > today ? today : last };
  }
  if (s.period === 'custom') return { p: 'custom', a: s.from <= s.to ? s.from : s.to, b: s.from <= s.to ? s.to : s.from };
  const all = presets(d, today), p = all.find((x) => x.value === s.period) || all.find((x) => x.value === 'last3') || all[0];
  return { p: p.value, a: p.a, b: p.b };
}
