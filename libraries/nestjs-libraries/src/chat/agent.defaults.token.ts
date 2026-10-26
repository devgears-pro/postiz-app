import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';

export const AGENT_DEFAULTS = Symbol('AGENT_DEFAULTS');

export type AgentDefaultsProvider = {
  get(): Promise<SystemAgentDefaults>;
};
