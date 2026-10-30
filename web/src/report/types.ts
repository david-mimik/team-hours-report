import { z } from 'zod';

// The tool schemas ARE the generative-UI contract: CopilotKit sends them to the agent (AG-UI `tools`),
// the model fills them in, and the matching component renders the block.

const cell = z.union([z.string(), z.number()]);

// Dashboard layout: blocks sit on a 6-column grid. full = a row, half = two per row, third = three per row.
const width = z.enum(['full', 'half', 'third']).optional()
  .describe('Width on the dashboard grid: full (default for tables), half (two side by side), third (three side by side)');

export const kpisSchema = z.object({
  title: z.string().optional().describe('Optional heading for the KPI row'),
  items: z.array(z.object({
    label: z.string().describe('Metric name'),
    value: z.string().describe('Formatted value, e.g. "1,240" or "$3.2M"'),
    delta: z.number().optional().describe('Change vs. previous period, in percent'),
    previous: z.string().optional().describe('The comparison value, e.g. "11" (shown as "<previousLabel> 11")'),
    previousLabel: z.string().optional().describe('What previous is, e.g. "Last month", "Previous sprint"'),
    caption: z.string().optional().describe('A short line under the value, e.g. "of 2,700 h capacity"'),
  })).describe('One to six KPI cards'),
  width,
});

// Chart kinds: general ones, and the agile charts the agile tools (mim/src/agile.js) return rows for.
export const CHART_KINDS = [
  'bar', 'stackedBar', 'horizontalBar', 'line', 'area', 'stackedArea', 'pie', 'donut', 'scatter', 'combo',
  'burndown', 'burnup', 'velocity', 'cfd', 'controlChart', 'gauge', 'percentBar',
] as const;

export const chartSchema = z.object({
  title: z.string().describe('Chart title'),
  subtitle: z.string().optional().describe('One line under the title: period, unit or how to read it'),
  kind: z.enum(CHART_KINDS).describe(
    'bar: compare categories · stackedBar: parts of each category (e.g. phases per week) · horizontalBar: long labels (people, tickets) · '
    + 'line / area: trends over time · stackedArea: composition over time · pie / donut: shares of a whole · scatter: one point per item · '
    + 'combo: bars plus lineSeries as lines · burndown: series ["remaining","ideal"] from getSprintBurndown · '
    + 'burnup: series ["completed","scope"] (+ "logged") from getSprintBurndown · velocity: series ["committed","completed"] from getVelocity · '
    + 'cfd: cumulative flow, series = cfdSeries from getFlowMetrics · controlChart: cycle time per ticket, xKey "done", series ["cycleDays"] · '
    + 'gauge: one value against max (e.g. hours logged vs capacity), data [{"label":"Logged","value":2184}], series ["value"], max · '
    + 'percentBar: horizontal 100% stacked bars, each row split into shares (e.g. bugs per status by priority)',
  ),
  xKey: z.string().describe('Column used for the x axis (the category axis for horizontalBar, slice names for pie/donut)'),
  series: z.array(z.string()).describe('Numeric columns to plot, in drawing order (the first is the bottom of a stack)'),
  data: z.array(z.record(z.string(), cell.nullable())).describe('Rows to plot, e.g. [{"week":"Wk Oct 20","Development":120}]; null leaves a gap'),
  unit: z.string().optional().describe('Unit of the values, e.g. "h", "issues", "days"'),
  lineSeries: z.array(z.string()).optional().describe('combo only: the series drawn as lines (the others are bars)'),
  referenceLines: z.array(z.object({ y: z.number(), label: z.string() })).optional()
    .describe('Horizontal guide lines, e.g. average velocity, 85th percentile cycle time, capacity'),
  max: z.number().optional().describe('gauge only: the full-scale value, e.g. capacity hours'),
  width,
});

export const tableSchema = z.object({
  title: z.string().describe('Table title'),
  columns: z.array(z.string()).describe('Column headers'),
  rows: z.array(z.array(cell)).describe('Rows, in the same order as columns'),
  heatColumns: z.array(z.string()).optional().describe('Numeric columns to shade by value (darker = higher), e.g. a completion % column'),
  width,
});

export const insightSchema = z.object({
  title: z.string().describe('One-line finding'),
  body: z.string().describe('Two or three sentences explaining the finding'),
  tone: z.enum(['info', 'positive', 'warning', 'critical']).describe('How the finding should be read'),
  width,
});

export type KpisBlock = z.infer<typeof kpisSchema>;
export type ChartBlock = z.infer<typeof chartSchema>;
export type TableBlock = z.infer<typeof tableSchema>;
export type InsightBlock = z.infer<typeof insightSchema>;

export type BlockData =
  | { type: 'kpis'; props: KpisBlock }
  | { type: 'chart'; props: ChartBlock }
  | { type: 'table'; props: TableBlock }
  | { type: 'insight'; props: InsightBlock };

export type ReportBlock = BlockData & { id: string };
