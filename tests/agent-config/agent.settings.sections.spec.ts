import {
  AGENT_SETTINGS_SECTIONS,
  agentSettingsSectionTitle,
} from '@gitroom/frontend/components/agents/agent.settings.sections';

describe('agent settings sections', () => {
  it('lists the organization sections in display order', () => {
    expect(AGENT_SETTINGS_SECTIONS).toEqual([
      'prompt',
      'model',
      'tools',
      'skills',
      'mcp',
    ]);
  });

  it('has no Langfuse section: tracing is deployment-only', () => {
    expect(AGENT_SETTINGS_SECTIONS).not.toContain('langfuse');
  });

  it('resolves a human title for every section', () => {
    for (const section of AGENT_SETTINGS_SECTIONS) {
      expect(agentSettingsSectionTitle(section)).toEqual(expect.any(String));
      expect(agentSettingsSectionTitle(section).length).toBeGreaterThan(0);
    }
  });
});
