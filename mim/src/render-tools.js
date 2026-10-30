// The page's render tools as JSON Schema, for the MCP server (mcp.js). The MCP gateway reads tools/list once when it
// connects the server, before any page has sent its tools, so they are listed from here. Keep in step with
// web/src/report/types.ts and useReportTools.tsx (the page's zod schemas are the contract).
const cell = { anyOf: [{ type: 'string' }, { type: 'number' }] };
const CHART_KINDS = ['bar', 'stackedBar', 'horizontalBar', 'line', 'area', 'stackedArea', 'pie', 'donut', 'scatter', 'combo',
  'burndown', 'burnup', 'velocity', 'cfd', 'controlChart', 'gauge', 'percentBar'];
// Dashboard layout: blocks sit on a 6-column grid.
const width = { type: 'string', enum: ['full', 'half', 'third'], description: 'Width on the dashboard grid: full (default for tables), half (two side by side), third (three side by side)' };

const RENDER_TOOLS = [
  {
    name: 'renderKpis',
    description: 'Add a row of KPI cards (headline numbers) to the report.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional heading for the KPI row' },
        items: {
          type: 'array',
          description: 'One to six KPI cards',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Metric name' },
              value: { type: 'string', description: 'Formatted value, e.g. "1,240" or "$3.2M"' },
              delta: { type: 'number', description: 'Change vs. previous period, in percent' },
              previous: { type: 'string', description: 'The comparison value, e.g. "11" (shown as "<previousLabel> 11")' },
              previousLabel: { type: 'string', description: 'What previous is, e.g. "Last month", "Previous sprint"' },
              caption: { type: 'string', description: 'A short line under the value, e.g. "of 2,700 h capacity"' },
            },
            required: ['label', 'value'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'renderChart',
    description: 'Add a chart to the report: general charts (bar, stacked, line, area, pie, donut, scatter, combo) and agile '
      + 'charts (burndown, burnup, velocity, cumulative flow, control chart).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Chart title' },
        subtitle: { type: 'string', description: 'One line under the title: period, unit or how to read it' },
        kind: {
          type: 'string',
          enum: CHART_KINDS,
          description: 'bar: compare categories · stackedBar: parts of each category (e.g. phases per week) · horizontalBar: long labels (people, tickets) · '
            + 'line / area: trends over time · stackedArea: composition over time · pie / donut: shares of a whole · scatter: one point per item · '
            + 'combo: bars plus lineSeries as lines · burndown: series ["remaining","ideal"] from getSprintBurndown · '
            + 'burnup: series ["completed","scope"] (+ "logged") from getSprintBurndown · velocity: series ["committed","completed"] from getVelocity · '
            + 'cfd: cumulative flow, series = cfdSeries from getFlowMetrics · controlChart: cycle time per ticket, xKey "done", series ["cycleDays"] · '
            + 'gauge: one value against max (e.g. hours logged vs capacity), data [{"label":"Logged","value":2184}], series ["value"], max · '
            + 'percentBar: horizontal 100% stacked bars, each row split into shares (e.g. bugs per status by priority)',
        },
        xKey: { type: 'string', description: 'Column used for the x axis (the category axis for horizontalBar, slice names for pie/donut)' },
        series: { type: 'array', items: { type: 'string' }, description: 'Numeric columns to plot, in drawing order (the first is the bottom of a stack)' },
        data: { type: 'array', items: { type: 'object', additionalProperties: { anyOf: [cell.anyOf[0], cell.anyOf[1], { type: 'null' }] } }, description: 'Rows to plot, e.g. [{"week":"Wk Oct 20","Development":120}]; null leaves a gap' },
        unit: { type: 'string', description: 'Unit of the values, e.g. "h", "issues", "days"' },
        lineSeries: { type: 'array', items: { type: 'string' }, description: 'combo only: the series drawn as lines (the others are bars)' },
        referenceLines: {
          type: 'array',
          items: { type: 'object', properties: { y: { type: 'number' }, label: { type: 'string' } }, required: ['y', 'label'] },
          description: 'Horizontal guide lines, e.g. average velocity, 85th percentile cycle time, capacity',
        },
        max: { type: 'number', description: 'gauge only: the full-scale value, e.g. capacity hours' },
      },
      required: ['title', 'kind', 'xKey', 'series', 'data'],
    },
  },
  {
    name: 'renderTable',
    description: 'Add a data table to the report.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Table title' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Column headers' },
        rows: { type: 'array', items: { type: 'array', items: cell }, description: 'Rows, in the same order as columns' },
        heatColumns: { type: 'array', items: { type: 'string' }, description: 'Numeric columns to shade by value (darker = higher), e.g. a completion % column' },
      },
      required: ['title', 'columns', 'rows'],
    },
  },
  {
    name: 'renderInsight',
    description: 'Add one written finding (insight callout) to the report.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'One-line finding' },
        body: { type: 'string', description: 'Two or three sentences explaining the finding' },
        tone: { type: 'string', enum: ['info', 'positive', 'warning', 'critical'], description: 'How the finding should be read' },
      },
      required: ['title', 'body', 'tone'],
    },
  },
  {
    name: 'clearReport',
    description: 'Remove every block from the report. Only when the user asks for a new report.',
    inputSchema: { type: 'object', properties: {} },
  },
];

RENDER_TOOLS.forEach((t) => { if (t.name !== 'clearReport') t.inputSchema.properties.width = width; });

module.exports = { RENDER_TOOLS };
