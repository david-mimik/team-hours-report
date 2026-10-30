# team-hours-report

A **Generative UI report** built with **CopilotKit** and shipped as **one mim on mimOE**. The user asks for a report in
the chat. A local LLM on the mimOE node reads the data and "calls" UI components (KPI cards, charts, tables,
insights), and CopilotKit renders them onto the report canvas.

```
 Browser                                         mimOE node (localhost:8083)
┌───────────────────────────────┐              ┌──────────────────────────────────────────────┐
│ React + CopilotKit v2         │  GET /       │ team-hours-report mim   /api/team-hours-report/v1      │
│                               │◀─────────────│  page files (stored in the mim, ui:* items)  │
│  ReportCanvas   CopilotChat   │              │                                              │
│      ▲              │         │  POST /agui  │  AG-UI agent loop (src/agui.js)              │
│      │ handler      │ HttpAgent ────────────▶│   ├─ server tools: listDatasets, getDataset  │
│  useFrontendTool ◀──┘         │◀── SSE ──────│   └─ frontend tools: sent by the page ───┐   │
│  renderKpis / renderChart /   │  AG-UI events│                                          │   │
│  renderTable / renderInsight  │              │  /mimik-airouter/openai/v1 ─▶ milm (local LLM)│
└───────────────────────────────┘              └──────────────────────────────────────────────┘
```

## How a report is generated

1. CopilotKit sends the **AG-UI** `RunAgentInput` to `POST /agui`: the messages, plus the **frontend tools** registered
   with `useFrontendTool`. Their zod schemas are the generative-UI contract.
2. The mim calls the local LLM with the server tools and the frontend tools together. Server tools (`listDatasets`,
   `getDataset`) run inside the mim, and their results stream back as `TOOL_CALL_RESULT`.
3. When the model calls a frontend tool (e.g. `renderChart`), the mim emits `TOOL_CALL_*` and ends the run.
   CopilotKit runs the tool's `handler`, which adds the block to the canvas, and its `render`, which shows the chip in
   the chat. It then starts a follow-up run with the result, so the agent keeps building.

Verified end to end with Claude Code through Muster: "Team dashboard, this month" builds 8 blocks (KPIs with month-over-month
comparisons, a tasks-by-status donut, planned vs closed per sprint, an hours-vs-capacity gauge, a per-person table, estimate vs
logged per person, bugs by status and priority) in about 75 s; "Sprint dashboard" builds 6 in about 40 s.

## Project structure

```
team-hours-report/
├── package.json              root scripts: build, deploy, dev
├── web/                      the page (Vite + React 19 + CopilotKit 1.82, v2 API)
│   ├── vite.config.ts        flat, text-only build (fonts inlined); /api proxy for dev
│   └── src/
│       ├── App.tsx           CopilotKitProvider + canvas + CopilotChat
│       ├── copilot/connection.ts   how the page reaches the agent (direct or runtime, see below)
│       ├── report/types.ts         zod schemas of the blocks = the tool contract
│       ├── report/useReportTools.tsx   frontend tools (generative UI)
│       ├── report/ReportContext.tsx    report state (the blocks on the canvas)
│       └── components/       KpiRow, Chart (recharts), DataTable, Insight, ReportCanvas
└── mim/                      the mim (ES5 bundle for the mimOE JS runtime)
    ├── src/index.js          routes: page, /agui, /datasets, /ui upload, /healthcheck
    ├── src/agui.js           AG-UI protocol + agent loop
    ├── src/llm.js            OpenAI-compatible call to the node's inference (not streamed)
    ├── src/instructions.js   system prompt (edit to change the analyst's behaviour)
    ├── src/datasets.js       datasets in storage + server tools
    ├── config/default.yml    packager config (image team-hours-report-v1)
    ├── config/start-example.json   deployment env
    ├── scripts/deploy.sh     upload image, deploy, upload page
    ├── scripts/upload-ui.cjs page upload (web/dist → mim storage)
    └── test/local.http       REST Client requests (datasets, AG-UI runs)
```

## Build and deploy

Installing on a new computer (Windows or macOS, step by step for IT): open [INSTALL.html](INSTALL.html).

Needs Node 18+ and a running mimOE node with an LLM in the model store. The MCM key is read from
`~/.mimoe/mimoe-api-key.env`.

```bash
npm run install:all     # web + mim dependencies
npm run deploy          # build web + mim, package, (re)deploy, upload the page
open http://localhost:8083/api/team-hours-report/v1/
npm run undeploy        # remove the mim and its image
```

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | `web/dist` + `mim/build/index.js` + `mim/deploy/team-hours-report-v1-<version>.tar` |
| `./mim/scripts/deploy.sh --ui` | re-upload only the page (after `npm --prefix web run build`) |
| `npm run dev` | Vite dev server on :5173 against the **deployed** mim (copy `web/.env.example` to `web/.env`) |

Deployment env (`mim/config/start-example.json`, override with environment variables when running `deploy.sh`):

| Variable | Default | |
|---|---|---|
| `INFERENCE_BASE_URI` | `/mimik-airouter/openai/v1/chat/completions` | AI router; or `/mimik-ai/openai/v1/chat/completions` for milm directly |
| `INFERENCE_MODEL` | `Qwen3.5-4B-Q8_0` | must be in the model store |
| `INFERENCE_API_KEY` | `1234` | |
| `THINKING_MODE` | `off` | `on` lets the model reason first, but each step then takes minutes |
| `MAX_TOKENS` | `2000` | |
| `WRITE_API_KEY` | empty | when set, `PUT/DELETE /datasets` and `PUT /ui` need `Authorization: Bearer <key>` |
| `MCM.MAX_EXECUTION_TIME_SEC` | `300` | one AG-UI run = several LLM calls |

## Data

The report's data is the team's hours (Tempo) and its Jira board, read by the server tools:

| Tool | What it gives | Charts it feeds |
|---|---|---|
| `getTeamTime` | hours by SDLC phase and person, series per day/week/month/sprint/person, capacity estimate | donut, stacked bars, trend lines, gauge |
| `getSprintBurndown` | one sprint day by day: ideal, remaining, scope, completed, logged (Jira's sprint report replayed) | burndown, burnup |
| `getVelocity` | committed vs completed per closed sprint (Jira's velocity chart), hours logged | velocity, combo |
| `getFlowMetrics` | cumulative flow per board column, cycle and lead time per ticket, weekly throughput | CFD, control chart, throughput |
| `getTicketStats` | tickets per status/assignee/priority/type/component (× a second field): done, %, estimate h, logged h | donut, planned vs done, percent bars, heat tables |

The board estimates in Original Time Estimate, so burndown, burnup and velocity are in hours. Chart kinds
(`web/src/report/types.ts`): bar, stackedBar, horizontalBar, line, area, stackedArea, pie, donut, scatter, combo, burndown,
burnup, velocity, cfd, controlChart, gauge, percentBar; every block takes a `width` (full, half, third) for dashboards.

Extra tables can still be uploaded (`GET /datasets` lists them; none by default):

```bash
curl -X PUT http://localhost:8083/api/team-hours-report/v1/datasets/q3-pipeline \
  -H 'Content-Type: application/json' \
  -d '{"title":"Q3 pipeline","rows":[{"stage":"Lead","deals":42},{"stage":"Won","deals":7}]}'
```

To report on live data instead (Jira, a database, another mim), add a server tool in `mim/src/datasets.js` that
fetches it with `requestAction` (`src/http.js`).

## Chat engine: Claude Code through Muster (as Team Advisor)

With `CHAT_ENGINE=claude` (the default) the chat runs on **Claude Code**, on your own Claude login, the way Team Advisor
does it: through **Muster** (`team-advisor/muster`, `http://127.0.0.1:5191/agent/v1`), with this mim's tools reached over
the **mimOE MCP gateway**.

```
page ──AG-UI──▶ mim /agui ──chat (SSE)──▶ Muster ──▶ claude (Claude Code session)
                                                        │ tools: mcp__mimoe__team-hours-report__*
                mim /mcp ◀──── mimOE MCP gateway ◀──────┘
```

- `mim/src/mcp.js`: `POST /mcp` serves `getTeamTime`, `listDatasets`, `getDataset` and the page's render tools
  (`mim/src/render-tools.js`: the gateway reads `tools/list` once when it connects the server, so they are listed
  statically; `getTeamTime` syncs from Tempo first when the snapshot is empty, e.g. after a redeploy).
- `mim/src/muster.js`: one user turn = `tools/call chat` on Muster; this mim's tools are approved on Claude's behalf,
  any other tool is refused. `agui.js` relays Claude's render-tool calls to the page as frontend tool calls, and answers
  CopilotKit's follow-up run with nothing (Claude already went on within its turn).
- Setup, once: `MUSTER_API_KEY` (Muster's `/agent/v1` bearer, from its gateway registration or Team Advisor's settings)
  in `.env`, `npm run deploy`, then `node mim/scripts/claude-setup.cjs`. That registers `/api/team-hours-report/v1/mcp` in the
  gateway as server `team-hours-report` and grants it to Muster's gateway key (`--remove` undoes both).
- `CLAUDE_MODEL` (`sonnet`, `opus`, …) picks the model; empty = Claude Code's default. `CHAT_ENGINE=local` goes back
  to the node's local LLM.
- Muster runs every conversation in Team Advisor's workspace, so the first message of each one carries this page's
  instructions (`claudePreamble` in `instructions.js`).

## Team Time report (Jira + Tempo)

A fixed report page at `<mim>/team-time.html` (React, no CopilotKit), ported from the v3 design mockup: **Time by
phase** (hours per SDLC phase, mix over time, per person or phase) and **Hours** (exact timesheet per month or ISO week,
drill-down to every worklog, CSV export). The Load view of the mockup (capacity, forecast, check-ins) is not built yet.

- `POST /team-time/sync` (`mim/src/teamtime.js`) reads every Tempo worklog of the last `TEAM_HISTORY_MONTHS` (24) for
  `TEAM_PROJECTS` (ZR), plus `TEAM_EXTRA_WORKLOGS` (`BES:Hassan Hasan Qadri`: only these people's BES worklogs), then
  the tickets, people (inactive Jira users = former members) and the board's sprints from Jira. It stores one compact
  snapshot (~600 KB) in the mim's storage, in about 20 s. The page's **Sync from Tempo** button calls it.
- `GET /team-time/data` returns the snapshot; the page computes every view from it in minutes, so totals tie to Tempo.
- The chat agent gets a `getTeamTime` server tool (totals by phase and person for a date range).
- Phase rules: `mim/src/phases.js` (component, then Bug, then label Testing/UX-UI, then the parent). Change a rule and
  sync again.

Credentials: put `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `TEMPO_API_TOKEN` (and optionally the `TEAM_*`
settings) in `team-hours-report/.env` (gitignored). `deploy.sh` passes them to the mim's env.

## Adding a generative UI component

1. Add a zod schema in `web/src/report/types.ts` and a member to `BlockData`.
2. Write the component in `web/src/components/` and add it to `BlockView` in `ReportCanvas.tsx`.
3. Register it with `useFrontendTool` in `useReportTools.tsx` (name, description, `parameters`, `handler`, `render`).
4. Mention it in `mim/src/instructions.js` so the model knows when to use it.
5. For the Claude engine, add its JSON Schema to `mim/src/render-tools.js`, deploy, and run
   `node mim/scripts/claude-setup.cjs` (restarts the gateway server so it lists the new tool).

With the local engine the mim needs no change: frontend tools reach it with every run. Keep the tool count small, since small local models
choose tools less reliably as the list grows.

## Connection modes: a decision to make

CopilotKit normally connects through its **runtime**, which is a Node server and cannot run inside a mim. This project
has the page talk to the mim's AG-UI endpoint directly, using CopilotKit's `selfManagedAgents` prop. It works without
a key, but CopilotKit logs that `selfManagedAgents` is part of its **Enterprise Intelligence tier** and needs a
`publicLicenseKey` for production use. Options (`web/src/copilot/connection.ts`):

| Mode | How | Trade-off |
|---|---|---|
| **Direct** (current) | `selfManagedAgents` → `<mim>/agui` | One mim, fully on-device. Needs a CopilotKit licence for production (`VITE_COPILOT_LICENSE_KEY`). |
| **Runtime** | set `VITE_COPILOT_RUNTIME_URL`; run `@copilotkit/runtime` (MIT) with the mim registered as an `HttpAgent` | No licence needed, but a Node process runs next to mimOE. Not a pure mim. |

## mimOE runtime notes (found while building this)

- **Lowercase response header names.** The gateway only recognises `content-type`, `transfer-encoding`, etc. in
  lowercase. With `Content-Type`/`Transfer-Encoding`, SSE went out buffered, with two header blocks and a
  `Content-Length`. The gateway adds the CORS headers itself.
- **Request bodies arrive only as `application/json`.** `text/plain` and `application/octet-stream` bodies reach the
  mim empty, so the page upload sends `{ "text": ... }`.
- **Don't bundle the page into the mim.** The mim's code is loaded for every request, and CopilotKit's page with its
  lazy chunks (syntax highlighting, mermaid) is about 18 MB. The page lives in storage instead (one item per file),
  which keeps `build/index.js` around 150 KB.
- `context.storage.saveFile` + `response.writeMimeFile` did not round-trip file contents here, so they are not used.
- `context.http` has no streaming callback, so each LLM step reaches the browser whole. AG-UI events still stream
  step by step.
