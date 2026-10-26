export const AGENT_SETTINGS_SECTIONS = [
  'prompt',
  'model',
  'tools',
  'skills',
  'mcp',
] as const;

export type AgentSettingsSection = (typeof AGENT_SETTINGS_SECTIONS)[number];

const titles: Record<AgentSettingsSection, [string, string]> = {
  prompt: ['agent_prompt_title', 'System prompt'],
  model: ['agent_model_title', 'Model and provider'],
  tools: ['agent_tools_title', 'Built-in tools'],
  skills: ['agent_skills_title', 'Skills'],
  mcp: ['agent_mcp_title', 'MCP servers'],
};

export const agentSettingsSectionTitle = (
  section: AgentSettingsSection
): string => titles[section][1];

export const agentSettingsSectionKey = (
  section: AgentSettingsSection
): string => titles[section][0];
