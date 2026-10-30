import { BLOCK_LABEL, nextSteps, SECTIONS } from '../report/guide';
import { useReport } from '../report/ReportContext';
import type { BlockData, ReportBlock } from '../report/types';
import { useAsk } from '../report/useAsk';
import { Chart } from './Chart';
import { DataTable } from './DataTable';
import { Insight } from './Insight';
import { KpiRow } from './KpiRow';

export function BlockView({ block }: { block: BlockData }) {
  switch (block.type) {
    case 'kpis': return <KpiRow {...block.props} />;
    case 'chart': return <Chart {...block.props} />;
    case 'table': return <DataTable {...block.props} />;
    case 'insight': return <Insight {...block.props} />;
  }
}

export const blockTitle = (b: BlockData) => ('title' in b.props && b.props.title) || BLOCK_LABEL[b.type].name;

// Scroll to a block and flash it, so the eye lands on what was just added or picked in the outline.
// The newest block with this title (a chat chip only knows the title of what it added).
export function focusBlockByTitle(title: string) {
  const el = [...document.querySelectorAll<HTMLElement>('.block-wrap')].reverse().find((e) => e.dataset.title === title);
  if (el) focusBlock(el.id.slice('block-'.length));
}

export function focusBlock(id: string) {
  const el = document.getElementById(`block-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function EmptyState({ ask, running }: { ask: (m: string) => void; running: boolean }) {
  return (
    <div className="empty-state">
      <div className="hero">
        <h2>Build a report by asking</h2>
        <p>Pick a question below or type your own in the chat. Claude reads the hours your team logged in Tempo and its Jira
          sprints, then adds KPIs, charts (phase mix, burndown, burnup, velocity, flow) and insights here. Keep asking to refine it.</p>
        <ol className="steps" aria-label="How it works">
          <li><b>1</b><span><strong>Ask</strong> a question about your data</span></li>
          <li><b>2</b><span><strong>Claude reads</strong> Tempo hours and Jira sprints</span></li>
          <li><b>3</b><span><strong>Blocks appear</strong> here, ready to refine</span></li>
        </ol>
      </div>
      <div className="sections">
        {SECTIONS.map((s) => (
          <section className="section-card" key={s.id} aria-labelledby={`sec-${s.id}`}>
            <header>
              <span className="section-icon" aria-hidden="true">{s.icon}</span>
              <div><h3 id={`sec-${s.id}`}>{s.title}</h3><p>{s.hint}</p></div>
            </header>
            <div className="question-list">
              {s.questions.map((q) => (
                <button key={q.title} className="question" disabled={running} onClick={() => ask(q.message)} title={q.message}>
                  <span>{q.title}</span><span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Working() {
  return (
    <div className="working" role="status" aria-live="polite">
      <div className="working-bar" aria-hidden="true" />
      <div className="working-text">
        <strong>Claude is working on your report</strong>
        <span>Reading the data and choosing the blocks. This usually takes 20–60 seconds.</span>
      </div>
    </div>
  );
}

function Outline({ blocks }: { blocks: ReportBlock[] }) {
  return (
    <nav className="outline" aria-label="Report sections">
      {blocks.map((b, i) => (
        <button key={b.id} className="outline-chip" onClick={() => focusBlock(b.id)}>
          <span className="outline-n">{i + 1}</span><span aria-hidden="true">{BLOCK_LABEL[b.type].icon}</span><span>{blockTitle(b)}</span>
        </button>
      ))}
    </nav>
  );
}

export function ReportCanvas() {
  const { blocks, clear } = useReport();
  const { ask, running } = useAsk();
  const title = blocks.find((b) => b.type !== 'insight' && 'title' in b.props && b.props.title);

  return (
    <main className="canvas" aria-busy={running}>
      {blocks.length === 0 ? (
        <>
          {running && <Working />}
          <EmptyState ask={ask} running={running} />
        </>
      ) : (
        <>
          <header className="report-head">
            <div>
              <p className="eyebrow">Report · {blocks.length} section{blocks.length === 1 ? '' : 's'}</p>
              <h1>{title ? blockTitle(title) : 'Report'}</h1>
            </div>
            <div className="report-actions">
              <button className="btn-text" onClick={() => window.print()}>Print / PDF</button>
              <button className="btn-tonal" onClick={clear} disabled={running}>New report</button>
            </div>
          </header>
          <Outline blocks={blocks} />
          <div className="report-grid">
            {blocks.map((b, i) => (
              <div className={`block-wrap w-${b.props.width || 'full'}`} id={`block-${b.id}`} data-title={blockTitle(b)} key={b.id}>
                <span className="block-label"><span className="outline-n">{i + 1}</span>{BLOCK_LABEL[b.type].name}</span>
                <BlockView block={b} />
              </div>
            ))}
          </div>
          {running && <Working />}
          {!running && (
            <section className="next-steps" aria-label="Next steps">
              <h2>Keep going</h2>
              <div className="chips">
                {nextSteps(blocks).map((q) => <button key={q.title} className="chip" onClick={() => ask(q.message)}>{q.title}</button>)}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
