import {
  AGENT_CONFIG_LIMITS,
  agentConfigOverridesSchema,
  agentConfigWriteRequestSchema,
  resolveAgentConfig,
  toAgentConfigView,
  validateOverrides,
  type SystemAgentDefaults,
} from '@gitroom/helpers/agent/agent.config.schema';

const DEFAULTS: SystemAgentDefaults = {
  prompt: 'built-in prompt',
  model: 'system-model',
  titleModel: 'system-title-model',
  providerBaseUrl: 'https://llm.example.test/v1',
  providerApiKeyEnv: 'OPENAI_API_KEY',
  builtinTools: ['integrationList', 'integrationSchedulePostTool'],
  allowedBuiltinTools: [
    'integrationList',
    'integrationSchedulePostTool',
    'postsListTool',
  ],
  skills: {
    marketing: {
      name: 'marketing',
      description: 'Marketing guidance',
      instructions: 'Shared marketing instructions',
      references: { 'brand.md': 'Brand voice' },
    },
    support: {
      name: 'support',
      description: 'Support guidance',
      instructions: 'Shared support instructions',
    },
  },
  mcpServers: {
    'shared-crm': {
      url: 'https://crm.example.test/mcp',
      auth: 'bearer',
      bearerTokenEnv: 'CRM_TOKEN',
      enabledTools: ['findCustomer'],
    },
  },
  generation: { maxSteps: 10 },
  langfuse: {
    enabled: true,
    baseUrl: 'https://langfuse.example.test',
    publicKeyEnv: 'LANGFUSE_PUBLIC_KEY',
    secretKeyEnv: 'LANGFUSE_SECRET_KEY',
    allowedBaseUrls: ['https://langfuse.example.test'],
    captureContent: false,
  },
  sources: {
    prompt: 'builtin',
    model: 'env',
    providerBaseUrl: 'env',
    builtinTools: 'builtin',
    generation: 'builtin',
    langfuse: 'env',
    skills: 'file',
    mcpServers: 'file',
  },
  defaultsVersion: 'defaults-v1',
};

const resolve = (overrides: Parameters<typeof resolveAgentConfig>[1]) =>
  resolveAgentConfig(DEFAULTS, overrides, 'org-1', 3);

const validOverrides = (
  overrides: Parameters<typeof agentConfigOverridesSchema.parse>[0] = {}
) => agentConfigOverridesSchema.parse(overrides);

describe('resolveAgentConfig', () => {
  it('inherits every system value when overrides are empty', () => {
    const config = resolve(validOverrides());

    expect(config.prompt).toBe('built-in prompt');
    expect(config.model).toBe('system-model');
    expect(config.titleModel).toBe('system-title-model');
    expect(config.builtinTools).toEqual([
      'integrationList',
      'integrationSchedulePostTool',
    ]);
    expect(config.provider).toEqual({
      baseUrl: 'https://llm.example.test/v1',
      credential: 'system',
    });
    expect(config.sources.prompt).toBe('builtin');
    expect(config.organizationId).toBe('org-1');
    expect(config.revision).toBe(3);
    expect(config.defaultsVersion).toBe('defaults-v1');
  });

  it('replaces only the prompt and marks its source', () => {
    const config = resolve(validOverrides({ systemPrompt: 'Our own rules' }));

    expect(config.prompt).toBe('Our own rules');
    expect(config.model).toBe('system-model');
    expect(config.sources.prompt).toBe('organization');
  });

  it('returns the current default after the override is removed', () => {
    const overridden = resolve(validOverrides({ systemPrompt: 'Own rules' }));
    const restored = resolve(validOverrides());

    expect(overridden.prompt).toBe('Own rules');
    expect(restored.prompt).toBe('built-in prompt');
    expect(restored.sources.prompt).toBe('builtin');
  });

  it('lets an organization model drive thread titles when no title model is set', () => {
    const config = resolve(validOverrides({ model: 'org-model' }));

    expect(config.model).toBe('org-model');
    expect(config.titleModel).toBe('org-model');
  });

  it('keeps the shared title model when only the chat model changes', () => {
    const config = resolve(
      validOverrides({ model: 'org-model', titleModel: 'org-title' })
    );

    expect(config.titleModel).toBe('org-title');
    expect(resolve(validOverrides()).titleModel).toBe('system-title-model');
  });

  it('treats a provider change as an organization credential', () => {
    const config = resolve(
      validOverrides({ provider: { baseUrl: 'https://org-llm.example.test/v1' } })
    );

    expect(config.provider).toEqual({
      baseUrl: 'https://org-llm.example.test/v1',
      credential: 'organization',
    });
  });

  it('keeps an explicit empty builtin tool list', () => {
    const config = resolve(validOverrides({ builtinTools: [] }));

    expect(config.builtinTools).toEqual([]);
    expect(config.sources.builtinTools).toBe('organization');
  });

  it('disables an inherited skill with a null entry', () => {
    const config = resolve(validOverrides({ skills: { support: null } }));

    expect(config.skills.map((skill) => skill.name)).toEqual(['marketing']);
  });

  it('replaces an inherited skill with the same stable name', () => {
    const config = resolve(
      validOverrides({
        skills: {
          marketing: {
            name: 'marketing',
            description: 'Local marketing',
            instructions: 'Local instructions',
          },
        },
      })
    );

    const marketing = config.skills.find((skill) => skill.name === 'marketing');
    expect(marketing).toEqual(
      expect.objectContaining({
        instructions: 'Local instructions',
        source: 'organization',
      })
    );
    expect(config.skills).toHaveLength(2);
  });

  it('disables an inherited MCP server and adds a local one', () => {
    const config = resolve(
      validOverrides({
        mcpServers: {
          'shared-crm': null,
          analytics: {
            url: 'https://analytics.example.test/mcp',
            auth: 'bearer',
            enabledTools: ['report'],
          },
        },
      })
    );

    expect(config.mcpServers).toEqual([
      expect.objectContaining({
        id: 'analytics',
        credential: 'organization',
        source: 'organization',
      }),
    ]);
  });

  it('keeps system MCP credentials on the inherited server only', () => {
    const config = resolve(validOverrides());

    expect(config.mcpServers).toEqual([
      expect.objectContaining({
        id: 'shared-crm',
        credential: 'system',
      }),
    ]);
  });

});

describe('agent config validation', () => {
  it('rejects unknown fields', () => {
    const parsed = agentConfigOverridesSchema.safeParse({
      systemPrompt: 'ok',
      surprise: true,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects filesystem references in organization settings', () => {
    const parsed = agentConfigOverridesSchema.safeParse({
      skills: {
        local: {
          name: 'local',
          description: 'Local',
          instructions: 'Text',
          references: { '../../etc/passwd': 'x' },
        },
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects an oversized prompt', () => {
    const prompt = 'x'.repeat(AGENT_CONFIG_LIMITS.promptBytes + 1);
    const parsed = agentConfigWriteRequestSchema.safeParse({
      expectedRevision: 0,
      overrides: { systemPrompt: prompt },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects too many skills after merging with defaults', () => {
    const skills = Object.fromEntries(
      Array.from({ length: AGENT_CONFIG_LIMITS.skills + 1 }, (_, index) => [
        `skill-${index}`,
        {
          name: `skill-${index}`,
          description: 'Skill',
          instructions: 'Instructions',
        },
      ])
    );

    const overrides = agentConfigOverridesSchema.parse({ skills });
    const issues = validateOverrides(DEFAULTS, overrides);

    expect(issues.map((issue) => issue.path)).toContain('skills');
  });

  it('rejects a builtin tool outside the allowed catalog', () => {
    const overrides = agentConfigOverridesSchema.parse({
      builtinTools: ['deletePostTool'],
    });
    const issues = validateOverrides(DEFAULTS, overrides);

    expect(issues.map((issue) => issue.path)).toContain('builtinTools');
  });

  it('rejects any organization Langfuse override', () => {
    const parsed = agentConfigOverridesSchema.safeParse({
      langfuse: { enabled: false },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects a non-https organization provider', () => {
    const parsed = agentConfigOverridesSchema.safeParse({
      provider: { baseUrl: 'http://org-llm.example.test/v1' },
    });

    expect(parsed.success).toBe(false);
  });
});

describe('toAgentConfigView', () => {
  it('shows sources and credential status without secret values', () => {
    const view = toAgentConfigView(
      DEFAULTS,
      validOverrides({ systemPrompt: 'Own rules' }),
      4,
      {
        provider: { source: 'system', configured: true },
        mcp: { 'shared-crm': { source: 'system', configured: true } },
      }
    );

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('OPENAI_API_KEY');
    expect(serialized).not.toContain('LANGFUSE_PUBLIC_KEY');
    expect(serialized).not.toContain('CRM_TOKEN');
    expect(view.revision).toBe(4);
    expect(view.sources.prompt).toBe('organization');
    expect(view.credentials.provider).toEqual({
      source: 'system',
      configured: true,
    });
    expect(view.capabilities.builtinTools).toEqual(
      DEFAULTS.allowedBuiltinTools
    );
  });

  it('keeps inherited skills visible for the form', () => {
    const view = toAgentConfigView(DEFAULTS, validOverrides(), 0, {
      provider: { source: 'system', configured: true },
      mcp: {},
    });

    expect(view.defaults.prompt).toBe('built-in prompt');
    expect((view.defaults as any).langfuse).toBeUndefined();
    expect((view.effective as any).langfuse).toBeUndefined();
    expect((view.credentials as any).langfuse).toBeUndefined();
    expect(view.defaults.skills.map((skill) => skill.name)).toEqual([
      'marketing',
      'support',
    ]);
    expect(view.overrides).toEqual({});
  });
});
