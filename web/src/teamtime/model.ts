// Team Time data model: the mim's snapshot (GET team-time/data), dates, periods and the sums every view is built from.
// All sums are in minutes, so rows and columns always add up exactly to their totals.

export type Snapshot = {
  v: 1;
  asOf: string;
  from: string;
  to: string;
  jiraBase: string;
  projects: string[];
  phases: string[];
  people: [string, 0 | 1][];
  sprints: [string, string, string, string][];
  issues: Record<string, [string, number, string]>;
  logs: [string, number, string, number, string][];
};

export type Person = { i: number; name: string; former: boolean; color: string };
export type Log = { date: string; p: number; key: string; proj: string; min: number; desc: string; phase: number };
export type Data = { snap: Snapshot; people: Person[]; logs: Log[]; sprints: Sprint[] };
export type Sprint = { name: string; full: string; start: string; end: string; state: string };

// Same order as mim/src/phases.js
export const PHASES: { name: string; color: string; desc: string; source: string }[] = [
  { name: 'Requirements', color: 'var(--p1)', desc: 'Understanding and writing down what to build: product specs, user stories, documentation.', source: 'Jira component “Product & Documentation”' },
  { name: 'Design', color: 'var(--p2)', desc: 'Deciding how to build it: system design, UX/UI, prototypes and their validation.', source: 'Components “Design: …” · label UX-UI' },
  { name: 'Development', color: 'var(--p3)', desc: 'Building the software: backend, APIs, microservices, mobile and web apps, agents, data, infrastructure.', source: 'Engineering components (Backend, Frontend, Microservices, Agents, Data, DevOps, …)' },
  { name: 'Testing', color: 'var(--p4)', desc: 'Checking it works: test plans, test runs, quality assurance.', source: 'Component “Testing & Quality Assurance” · label Testing' },
  { name: 'Fixing defects', color: 'var(--p5)', desc: 'Correcting problems found after something was built.', source: 'Issue type Bug (when no component decides first)' },
  { name: 'Planning & process', color: 'var(--p6)', desc: 'Running the work: sprint planning, ceremonies, delivery coordination.', source: 'Component “Delivery & Agile Processes”' },
  { name: 'Unclassified', color: 'var(--p7)', desc: 'Time on tickets with no component, issue type or label that maps to a phase (nor on their parent). Adding a component in Jira moves it to the right phase.', source: 'Nothing in Jira says which phase' },
];
export const UNCL = 6;

const AVATARS = ['#3b6fd8', '#8a5cd6', '#1f9e8f', '#e08a1e', '#d1495b', '#5c8a2e', '#2f8ab8', '#b85c9e', '#7a6a2e', '#3f7d5c', '#a35c2e', '#5d6bc4'];

export function load(snap: Snapshot): Data {
  const people = snap.people.map(([name, active], i) => ({ i, name, former: !active, color: active ? AVATARS[i % AVATARS.length] : '#7d8590' }));
  const logs = snap.logs.map(([date, p, key, min, desc]) => ({ date, p, key, min, desc, proj: key.split('-')[0], phase: (snap.issues[key] || ['', UNCL])[1] }));
  const sprints = snap.sprints.map(([full, start, end, state]) => ({ full, name: full.replace(/^[A-Z][A-Z0-9]*-\d{4}-/, ''), start, end, state }));
  return { snap, people, logs, sprints };
}

// ---- dates (ISO strings, UTC arithmetic) ----
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DD = (s: string) => new Date(s + 'T00:00:00Z');
export const isoD = (d: Date) => d.toISOString().slice(0, 10);
export const plusD = (s: string, n: number) => isoD(new Date(DD(s).getTime() + n * 864e5));
export const dd = (s: string) => MON[+s.slice(5, 7) - 1] + ' ' + +s.slice(8, 10);
export const lbl = (a: string, b: string) => dd(a) + '–' + (a.slice(0, 7) === b.slice(0, 7) ? String(+b.slice(8, 10)) : dd(b));
export const monthEnd = (ym: string) => isoD(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)));
export const addMonths = (ym: string, n: number) => isoD(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1))).slice(0, 7);
export const wdays = (a: string, b: string) => {
  let n = 0;
  for (let d = DD(a); d <= DD(b); d = new Date(d.getTime() + 864e5)) if (d.getUTCDay() % 6) n++;
  return n;
};
export const isoWeek = (s: string) => {
  const t = DD(s);
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
};
export const mondayOf = (s: string) => plusD(s, -((DD(s).getUTCDay() + 6) % 7));
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---- formatting ----
// minutes -> "12h 30m"
export const fmt = (m: number) => {
  const r = Math.round(m), hh = Math.floor(r / 60), mm = r % 60;
  return (hh ? hh.toLocaleString('en-US') + 'h' : '') + (mm ? (hh ? ' ' : '') + mm + 'm' : hh ? '' : '0h');
};
export const pct = (part: number, whole: number) => Math.round((100 * part) / (whole || 1));
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

// ---- periods ----
export type Range = { p: string; a: string; b: string };
export type Gran = 'sprint' | 'week' | 'month';
export type Period = { name: string; a: string; b: string; ca: string; cb: string; days: number; sub: string; clipped: boolean };

export const closedSprints = (d: Data, today: string) => d.sprints.filter((s) => s.end < today);
export const currentSprint = (d: Data, today: string) => d.sprints.find((s) => s.start <= today && today <= s.end) || d.sprints.find((s) => s.start > today);

export function presets(d: Data, today: string): { value: string; label: string; a: string; b: string }[] {
  const ym = today.slice(0, 7), out: { value: string; label: string; a: string; b: string }[] = [];
  const mm = (k: number) => addMonths(ym, -k) + '-01';
  out.push({ value: 'thismonth', label: `This month (${lbl(ym + '-01', today)})`, a: ym + '-01', b: today });
  out.push({ value: 'months', label: `Last 3 months (${MON[+mm(2).slice(5, 7) - 1]}–${MON[+ym.slice(5, 7) - 1]})`, a: mm(2), b: today });
  out.push({ value: 'months6', label: `Last 6 months (${MON[+mm(5).slice(5, 7) - 1]}–${MON[+ym.slice(5, 7) - 1]})`, a: mm(5), b: today });
  out.push({ value: 'months12', label: `Last 12 months (${MON[+mm(11).slice(5, 7) - 1]} ${mm(11).slice(0, 4)}–${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)})`, a: mm(11), b: today });
  const cur = currentSprint(d, today), closed = closedSprints(d, today);
  if (cur) out.push({ value: 'cur', label: `Current sprint (${cur.name} · ${lbl(cur.start, cur.end)})`, a: cur.start, b: cur.end });
  [3, 6].forEach((n) => {
    const s = closed.slice(-n);
    if (s.length) out.push({ value: 'last' + n, label: `Last ${n} sprints (${lbl(s[0].start, s[s.length - 1].end)})`, a: s[0].start, b: s[s.length - 1].end });
  });
  return out;
}

// Each sprint owns the days from its start to the day before the next sprint starts, so weekends and the gaps between
// sprints still land in a column and the columns add up to the period's total. Titles show Jira's own dates.
function pool(d: Data, g: Gran, a: string, b: string) {
  if (g === 'sprint') {
    return d.sprints.map((s, k) => ({ name: s.name, a: s.start, b: k + 1 < d.sprints.length ? plusD(d.sprints[k + 1].start, -1) : s.end, sub: lbl(s.start, s.end) }));
  }
  const out: { name: string; a: string; b: string; sub: string }[] = [];
  if (g === 'week') {
    for (let m = mondayOf(a); m <= b; m = plusD(m, 7)) out.push({ name: 'W' + isoWeek(m), a: m, b: plusD(m, 6), sub: lbl(m, plusD(m, 6)) });
  } else {
    for (let ym = a.slice(0, 7); ym <= b.slice(0, 7); ym = addMonths(ym, 1)) out.push({ name: MON[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4), a: ym + '-01', b: monthEnd(ym), sub: '' });
  }
  return out;
}

// periods of one kind that overlap [a, b], clipped to it
export function periodsIn(d: Data, g: Gran, a: string, b: string): Period[] {
  return pool(d, g, a, b).filter((x) => x.a <= b && x.b >= a).map((x) => {
    const ca = x.a < a ? a : x.a, cb = x.b > b ? b : x.b, days = wdays(ca, cb);
    return { name: x.name, a: x.a, b: x.b, ca, cb, days, clipped: ca !== x.a || cb !== x.b, sub: g === 'month' ? days + ' working days' : x.sub };
  });
}

export const autoGran = (rg: Range): Gran =>
  rg.p === 'cur' || rg.p === 'last3' || rg.p === 'last6' ? 'sprint'
    : rg.p === 'thismonth' || rg.p === 'month' ? 'week'
      : /^months/.test(rg.p) ? 'month'
        : (DD(rg.b).getTime() - DD(rg.a).getTime()) / 864e5 > 62 ? 'month' : 'week';

export const logsIn = (logs: Log[], a: string, b: string) => logs.filter((l) => l.date >= a && l.date <= b);

// ---- one rule for every view, so their totals agree to the minute ----
// The previous period: the same number of days just before the period (up to today).
export function prevRange(rg: Range, today: string) {
  const b0 = rg.b > today ? today : rg.b;
  const len = Math.round((DD(b0).getTime() - DD(rg.a).getTime()) / 864e5) + 1;
  return { a: plusD(rg.a, -len), b: plusD(rg.a, -1) };
}
// Who counts: the people selected (null = everyone). Former members count when they logged time in the window.
export const inScope = (p: Person, minutes: number, sel: string[] | null) => (!sel || sel.includes(p.name)) && (!p.former || minutes > 0);

// minutes per person in [a, b]
export function minutesByPerson(logs: Log[], a: string, b: string) {
  const out = new Map<number, number>();
  logsIn(logs, a, b).forEach((l) => out.set(l.p, (out.get(l.p) || 0) + l.min));
  return out;
}

// ---- forecast (Hours, optional): the next 3 ISO weeks from the last 8 full weeks ----
export function forecastWeeks(today: string) {
  const mon = mondayOf(today);
  return {
    next: [1, 2, 3].map((k) => ({ a: plusD(mon, 7 * k), b: plusD(mon, 7 * k + 6), w: isoWeek(plusD(mon, 7 * k)) })),
    hist: [8, 7, 6, 5, 4, 3, 2, 1].map((k) => ({ a: plusD(mon, -7 * k), b: plusD(mon, -7 * k + 6) })),
  };
}
const quantile = (v: number[], p: number) => {
  const x = v.slice().sort((a, b) => a - b), i = (x.length - 1) * p, lo = Math.floor(i);
  return x.length ? x[lo] + (x[Math.ceil(i)] - x[lo]) * (i - lo) : 0;
};
// weekly minutes -> likely hours a week: the middle 60% of the weeks (20th to 80th percentile) and the median
export const forecastRange = (weekly: number[]) => ({
  lo: Math.round(quantile(weekly, 0.2) / 60), mid: Math.round(quantile(weekly, 0.5) / 60), hi: Math.round(quantile(weekly, 0.8) / 60),
});
