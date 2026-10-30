// What the page offers to ask, grouped by section, and the next steps once a report exists. The canvas's empty state,
// the chat's welcome screen and its suggestion chips all read from here, so the guidance stays one voice.
// The questions name the chart they expect, so the answer looks the same every time.
import type { ReportBlock } from './types';

export type Question = { title: string; message: string };
export type Section = { id: string; icon: string; title: string; hint: string; questions: Question[] };

export const SECTIONS: Section[] = [
  {
    id: 'dashboard',
    icon: '▦',
    title: 'Team dashboards',
    hint: 'Several charts on one page, like a tracking board',
    questions: [
      { title: 'Team dashboard, this month', message: 'Build a team activity dashboard for this month: KPIs (hours logged, people, completion %, bugs closed vs last month), then side by side tasks by status (donut), planned vs closed tickets per sprint (bar) and hours logged vs capacity (gauge), then a table per person with tickets, done, completion %, estimate and logged hours, then estimate vs logged hours per person (horizontal bars) next to bugs by status and priority (100% bars).' },
      { title: 'Sprint dashboard', message: 'Build a dashboard of the current sprint: KPIs (committed, completed, remaining hours, scope change), burndown and burnup side by side, tasks by status (donut) next to tickets per person (planned vs done), and one insight.' },
    ],
  },
  {
    id: 'time',
    icon: '◔',
    title: 'Where the hours go',
    hint: 'Hours logged in Tempo, by SDLC phase',
    questions: [
      { title: 'This month by phase', message: 'Where did the team’s hours go this month? KPIs with total hours and the largest phase, a donut of hours by SDLC phase, a stacked bar of phases per week, and one insight.' },
      { title: 'Phase mix per sprint', message: 'Show the SDLC phase mix for the last 6 sprints as a stacked bar (hours per phase per sprint), and an insight on how it is shifting.' },
    ],
  },
  {
    id: 'sprint',
    icon: '⤓',
    title: 'Sprint health',
    hint: 'Burndown, burnup and scope change',
    questions: [
      { title: 'Current sprint burndown', message: 'How is the current sprint going? KPIs for committed, completed and remaining hours and scope change, the burndown chart, and an insight on whether we will finish.' },
      { title: 'Last sprint burnup', message: 'Show a burnup of the previous sprint with completed, scope and hours logged, plus KPIs for completion % and scope added after the start.' },
    ],
  },
  {
    id: 'delivery',
    icon: '▥',
    title: 'Velocity and predictability',
    hint: 'Committed vs completed, sprint over sprint',
    questions: [
      { title: 'Velocity, last 6 sprints', message: 'Show our velocity for the last 6 closed sprints: committed vs completed hours with the average as a reference line, KPIs for average velocity and say/do ratio, and an insight.' },
      { title: 'Estimate vs hours logged', message: 'Per sprint, compare completed estimate hours with the hours actually logged in Tempo: a combo chart with completed as bars and logged as a line, and what the gap means.' },
    ],
  },
  {
    id: 'flow',
    icon: '≋',
    title: 'Flow',
    hint: 'Cumulative flow, cycle time, throughput',
    questions: [
      { title: 'Cumulative flow, last 30 days', message: 'Show the cumulative flow diagram for the last 30 days, KPIs for work in progress and throughput, and an insight about bottlenecks.' },
      { title: 'Cycle time control chart', message: 'Show a cycle time control chart for tickets resolved in the last 60 days with the average and 85th percentile as reference lines, plus weekly throughput as a bar chart.' },
    ],
  },
  {
    id: 'people',
    icon: '◎',
    title: 'People and workload',
    hint: 'Who logged what, and where hours are low',
    questions: [
      { title: 'Hours per person, last 30 days', message: 'Show the hours each person logged in the last 30 days as a horizontal bar chart, and flag anyone unusually low.' },
      { title: 'Person × phase this month', message: 'Show this month’s hours per person split by SDLC phase as a stacked bar chart, and a table with the totals.' },
    ],
  },
  {
    id: 'quality',
    icon: '◇',
    title: 'Data quality',
    hint: 'Hours whose ticket says no phase',
    questions: [
      { title: 'Unclassified hours this quarter', message: 'How many hours this quarter have no SDLC phase? A KPI with the hours and share, a table of the 10 tickets holding most of them, and what to fix in Jira.' },
    ],
  },
];

// The chat's starting chips: one per main section.
export const STARTERS: Question[] = ['dashboard', 'time', 'sprint', 'delivery'].map((id) => SECTIONS.find((s) => s.id === id)!.questions[0]);

// Once the canvas has blocks: what usually comes next, depending on the charts already there.
export function nextSteps(blocks: ReportBlock[]): Question[] {
  const kinds = new Set(blocks.flatMap((b) => (b.type === 'chart' ? [b.props.kind] : [])));
  const has = (t: ReportBlock['type']) => blocks.some((b) => b.type === t);
  const q = (title: string, message: string) => ({ title, message });
  const out: Question[] = [];
  if (kinds.has('burndown')) out.push(q('Add the burnup', 'Add the burnup of the same sprint, with completed, scope and hours logged.'));
  if (kinds.has('burndown') || kinds.has('burnup')) out.push(q('Velocity trend', 'Add our velocity for the last 6 sprints, committed vs completed with the average.'));
  if (kinds.has('velocity')) out.push(q('Why the gap?', 'For the sprint with the biggest gap between committed and completed, show its burnup and explain what happened.'));
  if (kinds.has('cfd')) out.push(q('Cycle time', 'Add a cycle time control chart for the same period with the average and 85th percentile.'));
  if (kinds.has('controlChart')) out.push(q('Slowest tickets', 'Add a table of the 10 tickets with the longest cycle time in this period.'));
  if (kinds.has('pie') || kinds.has('donut') || kinds.has('stackedBar')) out.push(q('Per sprint', 'Show the same hours by SDLC phase per sprint for the last 6 sprints as a stacked bar.'));
  if (kinds.size && !has('table')) out.push(q('Add the numbers as a table', 'Add a table with the numbers behind the last chart.'));
  out.push(q('Compare with the previous period', 'Compare these numbers with the previous period of the same length, and add the change as KPIs with deltas.'));
  if (!has('insight')) out.push(q('What stands out?', 'What is the most important finding in this report? Add it as an insight.'));
  out.push(q('Start a new report', 'Clear the report and start a new one.'));
  return out.slice(0, 4);
}

// name: a label on its own; noun: inside a sentence ("Added KPIs", "Adding chart…")
export const BLOCK_LABEL: Record<ReportBlock['type'], { icon: string; name: string; noun: string }> = {
  kpis: { icon: '#', name: 'KPIs', noun: 'KPIs' },
  chart: { icon: '▥', name: 'Chart', noun: 'chart' },
  table: { icon: '☰', name: 'Table', noun: 'table' },
  insight: { icon: '✦', name: 'Insight', noun: 'insight' },
};
