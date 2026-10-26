import { Metadata } from 'next';
import { AgentShell } from '@gitroom/frontend/components/agents/agent.shell';
export const metadata: Metadata = {
  title: 'Postiz - Agent',
  description: 'agents',
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AgentShell>{children}</AgentShell>;
}
