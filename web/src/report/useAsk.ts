import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { useCallback } from 'react';
import { AGENT_ID } from '../copilot/connection';

// Ask the agent from anywhere on the page (the canvas's question cards), the same way CopilotChat sends a suggestion:
// add the user message, then run the agent. `running` is true while a turn is in flight.
export function useAsk() {
  const { agent } = useAgent({ agentId: AGENT_ID });
  const { copilotkit } = useCopilotKit();
  const ask = useCallback(async (message: string) => {
    if (agent.isRunning) return;
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: message });
    try {
      await copilotkit.runAgent({ agent });
    } catch (e) {
      console.error('ask: runAgent failed', e);
    }
  }, [agent, copilotkit]);
  return { ask, running: agent.isRunning };
}
