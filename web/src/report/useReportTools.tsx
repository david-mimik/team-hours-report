import { ToolCallStatus, useAgentContext, useFrontendTool } from '@copilotkit/react-core/v2';
import { z } from 'zod';
import { focusBlockByTitle } from '../components/ReportCanvas';
import { BLOCK_LABEL } from './guide';
import { useReport } from './ReportContext';
import { chartSchema, insightSchema, kpisSchema, tableSchema } from './types';

// Generative UI: each frontend tool is a component the agent can "call". CopilotKit sends the schemas to the mim's
// /agui endpoint; when the model calls a tool, `handler` adds the block to the report canvas and `render` shows the
// call's progress in the chat. The handler's return value goes back to the agent (followUp) so it can keep building.

// The chat's trace of each block: "Adding chart…" while it runs, then a chip that jumps to the block on the canvas.
function ToolChip({ kind, title, status }: { kind: keyof typeof BLOCK_LABEL; title?: string; status: ToolCallStatus }) {
  const done = status === ToolCallStatus.Complete;
  const { name, noun } = BLOCK_LABEL[kind];
  const label = title || name;
  if (!done) return <div className="tool-chip working"><span className="spinner" aria-hidden="true" />Adding {noun}{title ? `: ${title}` : '…'}</div>;
  return (
    <button className="tool-chip done" onClick={() => focusBlockByTitle(label)} title="Show it in the report">
      <span aria-hidden="true">{BLOCK_LABEL[kind].icon}</span>Added {noun}{title ? `: ${title}` : ''}<span aria-hidden="true">↗</span>
    </button>
  );
}

export function useReportTools() {
  const { blocks, add, clear } = useReport();

  // What is already on the canvas, so the agent can extend the report instead of repeating it.
  useAgentContext({
    description: 'Blocks currently in the report',
    value: blocks.map((b) => ({ type: b.type, title: 'title' in b.props ? b.props.title ?? null : null })),
  });

  useFrontendTool({
    name: 'renderKpis',
    description: 'Add a row of KPI cards (headline numbers) to the report.',
    parameters: kpisSchema,
    handler: async (props) => { add({ type: 'kpis', props }); return 'KPI row added to the report.'; },
    render: ({ args, status }) => <ToolChip kind="kpis" title={args.title} status={status} />,
  }, [add]);

  useFrontendTool({
    name: 'renderChart',
    description: 'Add a chart (bar, line, area or pie) to the report.',
    parameters: chartSchema,
    handler: async (props) => { add({ type: 'chart', props }); return `Chart "${props.title}" added to the report.`; },
    render: ({ args, status }) => <ToolChip kind="chart" title={args.title} status={status} />,
  }, [add]);

  useFrontendTool({
    name: 'renderTable',
    description: 'Add a data table to the report.',
    parameters: tableSchema,
    handler: async (props) => { add({ type: 'table', props }); return `Table "${props.title}" added to the report.`; },
    render: ({ args, status }) => <ToolChip kind="table" title={args.title} status={status} />,
  }, [add]);

  useFrontendTool({
    name: 'renderInsight',
    description: 'Add one written finding (insight callout) to the report.',
    parameters: insightSchema,
    handler: async (props) => { add({ type: 'insight', props }); return `Insight "${props.title}" added to the report.`; },
    render: ({ args, status }) => <ToolChip kind="insight" title={args.title} status={status} />,
  }, [add]);

  useFrontendTool({
    name: 'clearReport',
    description: 'Remove every block from the report. Only when the user asks for a new report.',
    parameters: z.object({}),
    handler: async () => { clear(); return 'Report cleared.'; },
  }, [clear]);
}
