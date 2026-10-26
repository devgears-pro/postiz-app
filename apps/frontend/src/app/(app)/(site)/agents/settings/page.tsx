import { Metadata } from 'next';
import { AgentSettings } from '@gitroom/frontend/components/agents/agent.settings';

export const metadata: Metadata = {
  title: 'Postiz - Agent settings',
  description: 'agent settings',
};

export default function Page() {
  return <AgentSettings />;
}
