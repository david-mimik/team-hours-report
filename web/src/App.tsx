import { CopilotChat, CopilotKitProvider, useConfigureSuggestions } from '@copilotkit/react-core/v2';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { focusBlock, ReportCanvas } from './components/ReportCanvas';
import { AGENT_ID, connectionProps } from './copilot/connection';
import { nextSteps, SECTIONS, STARTERS } from './report/guide';
import { ReportProvider, useReport } from './report/ReportContext';
import { useReportTools } from './report/useReportTools';

// The chat's first screen: what it can do, the starting questions (suggestionView) and the input.
function Welcome({ input, suggestionView }: { input: ReactElement; suggestionView: ReactElement }) {
  return (
    <div className="welcome">
      <div className="welcome-body">
        <div className="assistant-mark" aria-hidden="true">✦</div>
        <h2>What do you want to know?</h2>
        <p>I build the report on the left from the hours your team logged in Tempo and its Jira sprints. Ask in your own words, in any language.</p>
        <ul className="capabilities">
          {SECTIONS.map((s) => <li key={s.id}><span aria-hidden="true">{s.icon}</span><span><b>{s.title}</b> · {s.hint}</span></li>)}
        </ul>
        <p className="welcome-try">Try one of these</p>
        {suggestionView}
      </div>
      {input}
    </div>
  );
}

function ChatPanel() {
  const { blocks } = useReport();
  // Starting questions before the first message; afterwards, next steps that fit what the report already has.
  useConfigureSuggestions({ suggestions: blocks.length ? nextSteps(blocks) : STARTERS, available: 'always' }, [blocks.length]);
  return (
    <aside className="chat" aria-label="Report assistant">
      <header className="chat-head">
        <div className="assistant-mark small" aria-hidden="true">✦</div>
        <div>
          <h2>Report assistant</h2>
          <p>Claude · Tempo hours, Jira sprints and flow</p>
        </div>
      </header>
      <CopilotChat
        agentId={AGENT_ID}
        welcomeScreen={Welcome as never}
        labels={{ chatInputPlaceholder: 'Ask about hours, sprints, velocity, flow…', chatDisclaimerText: 'Claude can make mistakes. Numbers come from Tempo and Jira; check the Team Time page for exact totals.' }}
      />
    </aside>
  );
}

function Workspace() {
  useReportTools();
  const { blocks } = useReport();
  // Bring each new block into view as the agent adds it.
  const seen = useRef(0);
  useEffect(() => {
    if (blocks.length > seen.current && blocks.length) focusBlock(blocks[blocks.length - 1].id);
    seen.current = blocks.length;
  }, [blocks]);
  return (
    <div className="app">
      <header className="appbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">◧</span>Report studio</div>
        <nav className="tabs-nav" aria-label="Pages">
          <a href="index.html" aria-current="page">Ask &amp; build</a>
          <a href="team-time.html">Team Time dashboard</a>
        </nav>
      </header>
      <div className="layout">
        <ReportCanvas />
        <ChatPanel />
      </div>
    </div>
  );
}

export default function App() {
  const connection = useMemo(connectionProps, []);
  return (
    <CopilotKitProvider {...connection} agentId={AGENT_ID}>
      <ReportProvider>
        <Workspace />
      </ReportProvider>
    </CopilotKitProvider>
  );
}
