import type { RequestContext } from '@mastra/core/di';
import type { ResolvedAgentConfig } from '@gitroom/helpers/agent/agent.config.schema';

export const AGENT_RUNTIME = Symbol('AGENT_RUNTIME');

export type PreparedAgentForRuntime = {
  config: ResolvedAgentConfig;
  model: unknown;
  tools: Record<string, unknown>;
  skills: unknown[];
};

export type AgentRuntimeLike = {
  ensurePrepared(
    requestContext: RequestContext<any>
  ): Promise<PreparedAgentForRuntime>;
};
