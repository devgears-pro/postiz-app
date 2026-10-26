import type {
  AgentConfigOverrides,
  AgentConfigView,
} from '@gitroom/helpers/agent/agent.config.schema';
import {
  formMcpServers,
  formSkills,
  isDirty,
  promptEditorState,
  removeSkill,
  resetPrompt,
  setPrompt,
  setProvider,
  setSkillEnabled,
  toWriteRequest,
  upsertSkill,
  upsertMcpServer,
} from '@gitroom/frontend/components/agents/agent.settings.state';

const VIEW: AgentConfigView = {
  revision: 4,
  defaultsVersion: 'v1',
  defaults: {
    prompt: 'built-in prompt',
    model: 'system-model',
    titleModel: 'system-title',
    provider: { baseUrl: 'https://llm.example.test/v1' },
    builtinTools: ['integrationList'],
    skills: [
      {
        name: 'marketing',
        description: 'Marketing',
        instructions: 'Shared marketing',
      },
      {
        name: 'support',
        description: 'Support',
        instructions: 'Shared support',
      },
    ],
    mcpServers: [
      {
        id: 'crm',
        url: 'https://crm.example.test/mcp',
        auth: 'bearer',
        enabledTools: ['findCustomer'],
      },
    ],
    generation: {},
    langfuse: {
      enabled: true,
      baseUrl: 'https://langfuse.example.test',
      captureContent: false,
    },
  },
  overrides: {},
  effective: {
    prompt: 'built-in prompt',
    model: 'system-model',
    titleModel: 'system-title',
    provider: { baseUrl: 'https://llm.example.test/v1' },
    builtinTools: ['integrationList'],
    skills: [],
    mcpServers: [],
    generation: {},
    langfuse: {
      enabled: true,
      baseUrl: 'https://langfuse.example.test',
      captureContent: false,
    },
  },
  sources: { prompt: 'builtin' },
  capabilities: {
    builtinTools: ['integrationList', 'postsListTool'],
    langfuseBaseUrls: ['https://langfuse.example.test'],
  },
  credentials: {
    provider: { source: 'system', configured: true },
    mcp: {},
    langfuse: { source: 'system', configured: true },
  },
};

describe('agent settings state', () => {
  it('shows inherited skills and marks disabled ones', () => {
    const overrides: AgentConfigOverrides = { skills: { support: null } };
    const skills = formSkills({ ...VIEW, overrides });

    expect(skills).toEqual([
      expect.objectContaining({ name: 'marketing', enabled: true, inherited: true }),
      expect.objectContaining({ name: 'support', enabled: false, inherited: true }),
    ]);
  });

  it('shows a local skill next to inherited ones', () => {
    const overrides: AgentConfigOverrides = {
      skills: {
        local: {
          name: 'local',
          description: 'Local',
          instructions: 'Local instructions',
        },
      },
    };

    const skills = formSkills({ ...VIEW, overrides });

    expect(skills.find((skill) => skill.name === 'local')).toEqual(
      expect.objectContaining({ inherited: false, enabled: true })
    );
  });

  it('turns off an inherited skill with null', () => {
    const overrides = setSkillEnabled(VIEW, {}, 'support', false);

    expect(overrides.skills).toEqual({ support: null });
  });

  it('restores an inherited skill by removing the override', () => {
    const disabled = setSkillEnabled(VIEW, {}, 'support', false);
    const restored = setSkillEnabled(VIEW, disabled, 'support', true);

    expect(restored.skills).toEqual({});
  });

  it('removes a local skill when it is disabled', () => {
    const local = upsertSkill({}, {
      name: 'local',
      description: 'Local',
      instructions: 'Instructions',
    });
    const disabled = setSkillEnabled(VIEW, local, 'local', false);

    expect(disabled.skills).toEqual({});
  });

  it('removes a local skill and disables an inherited one', () => {
    const local = upsertSkill({}, {
      name: 'local',
      description: 'Local',
      instructions: 'Instructions',
    });

    expect(removeSkill(VIEW, local, 'local').skills).toEqual({});
    expect(removeSkill(VIEW, {}, 'support').skills).toEqual({ support: null });
  });

  it('keeps an empty prompt as an explicit override', () => {
    expect(setPrompt({ systemPrompt: 'Own' }, '').systemPrompt).toBe('');
    expect(setPrompt({}, '  ').systemPrompt).toBe('  ');
    expect(setPrompt({}, 'Own').systemPrompt).toBe('Own');
  });

  it('resets the prompt override on demand', () => {
    expect(
      resetPrompt({
        systemPrompt: '',
        provider: { baseUrl: 'https://own.example.test/v1' },
      })
    ).toEqual({ provider: { baseUrl: 'https://own.example.test/v1' } });
  });

  it('shows the file prompt until it is edited and after a reset', () => {
    expect(promptEditorState(VIEW, {})).toEqual({
      value: 'built-in prompt',
      edited: false,
    });
    expect(promptEditorState(VIEW, { systemPrompt: '' })).toEqual({
      value: '',
      edited: true,
    });
  });

  it('clears the provider override when the field becomes empty', () => {
    expect(
      setProvider({ provider: { baseUrl: 'https://own.example.test/v1' } }, '')
        .provider
    ).toBeUndefined();
    expect(setProvider({}, 'https://own.example.test/v1').provider).toEqual({
      baseUrl: 'https://own.example.test/v1',
    });
  });

  it('merges local and inherited MCP servers', () => {
    const servers = formMcpServers({
      ...VIEW,
      overrides: {
        mcpServers: {
          crm: null,
          local: {
            url: 'https://local.example.test/mcp',
            auth: 'none',
            enabledTools: [],
          },
        },
      },
    });

    expect(servers.map((server) => server.id)).toEqual(['crm', 'local']);
  });

  it('adds and removes a local MCP server', () => {
    const added = upsertMcpServer({}, 'local', {
      url: 'https://local.example.test/mcp',
      auth: 'none',
      enabledTools: [],
    });

    expect(added.mcpServers?.local).toEqual(
      expect.objectContaining({ url: 'https://local.example.test/mcp' })
    );
  });

  it('keeps secret inputs out of the request when they are empty', () => {
    const request = toWriteRequest(VIEW, {}, { providerApiKey: '' });

    expect(request.secrets).toBeUndefined();
    expect(request.expectedRevision).toBe(4);
  });

  it('detects unchanged and changed drafts', () => {
    expect(isDirty(VIEW, {}, {})).toBe(false);
    expect(isDirty(VIEW, { systemPrompt: 'Own' }, {})).toBe(true);
    expect(isDirty(VIEW, {}, { providerApiKey: 'sk' })).toBe(true);
  });
});
