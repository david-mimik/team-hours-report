import type { InsightBlock } from '../report/types';

export function Insight({ title, body, tone }: InsightBlock) {
  return (
    <section className={`block insight ${tone}`}>
      <h3>{title}</h3>
      <p>{body}</p>
    </section>
  );
}
