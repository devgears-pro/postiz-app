import {
  AgentConnectionsService,
  filterMcpTools,
} from '@gitroom/nestjs-libraries/chat/agent.connections';
import type { ResolvedAgentBundle } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import type {
  ResolvedAgentConfig,
  SystemAgentDefaults,
} from '@gitroom/helpers/agent/agent.config.schema';

const DEFAULTS = {
  prompt: 'p',
  model: 'system-model',
  titleModel: 'system-title',
  providerBaseUrl: 'https://llm.example.test/v1',
  providerApiKeyEnv: 'OPENAI_API_KEY',
  providerCredentialConfigured: true,
  builtinTools: [],
  allowedBuiltinTools: [],
  skills: {},
  mcpServers: {},
  generation: {},
  langfuse: {
    enabled: false,
    allowedBaseUrls: [],
    captureContent: false,
  },
  sources: {},
  defaultsVersion: 'v1',
} as SystemAgentDefaults;

const CONFIG = {
  organizationId: 'org-1',
  revision: 2,
  defaultsVersion: 'v1',
  prompt: 'p',
  model: 'org-model',
  titleModel: 'org-title',
  provider: { baseUrl: 'https://llm.example.test/v1', credential: 'system' },
  builtinTools: [],
  skills: [],
  mcpServers: [],
  generation: {},
  langfuse: { enabled: false, captureContent: false, credential: 'none' },
  sources: {},
} as ResolvedAgentConfig;

const bundle = (overrides: Partial<ResolvedAgentBundle> = {}): ResolvedAgentBundle => ({
  defaults: DEFAULTS,
  config: CONFIG,
  secrets: {},
  ...overrides,
});

const buildService = () => {
  const configService = { resolve: jest.fn() };
  const service = new AgentConnectionsService(configService as any);
  return { service, configService };
};

describe('filterMcpTools', () => {
  it('keeps only the enabled tools of each server', () => {
    const tools = filterMcpTools(
      [
        {
          id: 'crm',
          url: 'https://crm.example.test/mcp',
          auth: 'bearer',
          enabledTools: ['findCustomer'],
          source: 'organization',
          credential: 'organization',
        },
      ],
      {
        crm_findCustomer: { id: 'crm_findCustomer' },
        crm_deleteCustomer: { id: 'crm_deleteCustomer' },
        other_findCustomer: { id: 'other_findCustomer' },
      }
    );

    expect(Object.keys(tools)).toEqual(['crm_findCustomer']);
  });

  it('returns no tools when the organization enables none', () => {
    const tools = filterMcpTools(
      [
        {
          id: 'crm',
          url: 'https://crm.example.test/mcp',
          auth: 'none',
          enabledTools: [],
          source: 'file',
          credential: 'none',
        },
      ],
      { crm_findCustomer: {} }
    );

    expect(tools).toEqual({});
  });
});

describe('AgentConnectionsService', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  it('fails clearly when no system provider key is configured', () => {
    delete process.env.OPENAI_API_KEY;
    const { service } = buildService();

    expect(() => service.createModel(bundle())).toThrow(/OPENAI_API_KEY/);
  });

  it('fails clearly when an organization provider has no key', () => {
    const { service } = buildService();

    expect(() =>
      service.createModel(
        bundle({
          config: {
            ...CONFIG,
            provider: {
              baseUrl: 'https://own.example.test/v1',
              credential: 'organization',
            },
          },
        })
      )
    ).toThrow(/organization provider API key/);
  });

  it('tests the provider with a fixed message and no conversation data', async () => {
    process.env.OPENAI_API_KEY = 'system-key';
    const { service, configService } = buildService();
    configService.resolve.mockResolvedValue(bundle());
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await service.testProvider('org-1', {
      expectedRevision: 2,
      model: 'org-model',
    });

    expect(result).toEqual({ ok: true, model: 'org-model' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer system-key'
    );
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'Reply with OK.' }]);
  });

  it('does not send the deployment key to a different provider endpoint', async () => {
    process.env.OPENAI_API_KEY = 'system-key';
    const { service, configService } = buildService();
    configService.resolve.mockResolvedValue(bundle());

    const result = await service.testProvider('org-1', {
      expectedRevision: 2,
      provider: { baseUrl: 'https://own.example.test/v1' },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/API key/);
  });

  it('reports an unreachable provider without leaking the error', async () => {
    process.env.OPENAI_API_KEY = 'system-key';
    const { service, configService } = buildService();
    configService.resolve.mockResolvedValue(bundle());
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1'));

    const result = await service.testProvider('org-1', { expectedRevision: 2 });

    expect(result).toEqual({
      ok: false,
      model: 'org-model',
      reason: 'The provider is unreachable from this instance',
    });
  });
});
