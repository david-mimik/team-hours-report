# team-hours-report

Generative UI report: CopilotKit (React, v2 API) page + AG-UI agent, deployed together as one mim on mimOE.
README.md has the architecture, commands and the mimOE runtime notes. Read it first.

## Layout

- `web/`: Vite + React 19 + `@copilotkit/react-core@1.82.0` (import from `@copilotkit/react-core/v2`), `@ag-ui/client@1.0.2`
  (pinned to the version CopilotKit depends on). Frontend tools = `web/src/report/useReportTools.tsx`.
- `mim/`: ES5 mim bundle (webpack + Babel, `mimikModule.exports`). AG-UI loop = `mim/src/agui.js`.

## Rules

- mim code runs in the mimOE JS runtime, not Node: no `fetch`, `fs`, `path`, `process`, `Buffer`, `crypto`.
  HTTP via `requestAction` (`mim/src/http.js`), persistence via `global.context.storage`.
- Response header names in the mim: **lowercase** (`content-type`, `transfer-encoding`, `cache-control`).
- Request bodies to the mim must be `application/json`.
- Never `require` the web build into the mim bundle; keep `mim/build/index.js` small (it loads per request).
- Every frontend tool needs a `handler` that returns a short string (it goes back to the agent as the tool result).

## Verify a change

```bash
npm run deploy                                    # build + redeploy + upload page
curl -s http://localhost:8083/api/team-hours-report/v1/healthcheck
```

Then run the AG-UI requests in `mim/test/local.http`, or open the page and click "Sprint dashboard" (expected in about
40 s: KPIs, burndown and burnup side by side, tasks by status, tickets per person). Agile tools can be called directly
over MCP: `POST /mcp` `tools/call` `getSprintBurndown` / `getVelocity` / `getFlowMetrics` / `getTicketStats`.
- After changing a render tool's schema, keep `mim/src/render-tools.js` in step with `web/src/report/types.ts`, and run
  `node mim/scripts/claude-setup.cjs` after deploying (the gateway re-reads `tools/list` only on restart).
