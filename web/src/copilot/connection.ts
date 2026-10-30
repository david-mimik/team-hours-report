import { HttpAgent } from '@ag-ui/client';

export const AGENT_ID = 'report';

// Where the mim is. Deployed: the page is served by the mim, so './' is the mim's base path.
// Dev (vite): VITE_MIM_BASE=/api/team-hours-report/v1/ goes through the Vite proxy to the local mimOE node.
const mimBase = new URL(import.meta.env.VITE_MIM_BASE ?? './', window.location.href);

/**
 * Two ways to connect CopilotKit to the mim's AG-UI endpoint (see README, "Connection modes"):
 * - direct (default): the browser talks to <mim>/agui itself. One mim, nothing else to run.
 *   Uses `selfManagedAgents`, which CopilotKit licenses under its Enterprise tier for production use.
 * - runtime: an open-source CopilotKit runtime (Node) registers the mim as an HttpAgent and the page uses runtimeUrl.
 */
export function connectionProps() {
  const runtimeUrl = import.meta.env.VITE_COPILOT_RUNTIME_URL;
  if (runtimeUrl) return { runtimeUrl };
  return {
    selfManagedAgents: { [AGENT_ID]: new HttpAgent({ url: new URL('agui', mimBase).toString() }) },
    publicLicenseKey: import.meta.env.VITE_COPILOT_LICENSE_KEY || undefined,
  };
}
