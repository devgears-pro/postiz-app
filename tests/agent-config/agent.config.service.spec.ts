import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import { AgentConfigRepository } from '@gitroom/nestjs-libraries/database/prisma/agent-config/agent.config.repository';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';

const DEFAULTS: SystemAgentDefaults = {
  prompt: 'built-in prompt',
  model: 'system-model',
  titleModel: 'system-title-model',
  providerBaseUrl: 'https://llm.example.test/v1',
  providerApiKeyEnv: 'OPENAI_API_KEY',
  providerCredentialConfigured: true,
  builtinTools: ['integrationList'],
  allowedBuiltinTools: ['integrationList', 'postsListTool'],
  skills: {},
  mcpServers: {
    'shared-crm': {
      url: 'https://crm.example.test/mcp',
      auth: 'bearer',
      bearerTokenEnv: 'CRM_TOKEN',
      enabledTools: ['findCustomer'],
    },
  },
  generation: {},
  langfuse: {
    enabled: true,
    baseUrl: 'https://langfuse.example.test',
    publicKeyEnv: 'LANGFUSE_PUBLIC_KEY',
    secretKeyEnv: 'LANGFUSE_SECRET_KEY',
    allowedBaseUrls: ['https://langfuse.example.test'],
    captureContent: false,
    langfuseCredentialConfigured: true,
  },
  sources: { prompt: 'builtin', model: 'env', langfuse: 'env', skills: 'builtin' },
  defaultsVersion: 'defaults-v1',
};

const buildRepository = () => {
  const rows = new Map<string, any>();

  const repository = {
    find: jest.fn(async (organizationId: string) => rows.get(organizationId) ?? null),
    create: jest.fn(async (input: any) => {
      if (rows.has(input.organizationId)) throw new ConflictException();
      const row = { ...input, schemaVersion: 1, revision: 1 };
      rows.set(input.organizationId, row);
      return row;
    }),
    update: jest.fn(
      async (organizationId: string, expectedRevision: number, input: any) => {
        const row = rows.get(organizationId);
        if (!row || row.revision !== expectedRevision) throw new ConflictException();
        const next = { ...row, ...input, revision: row.revision + 1 };
        rows.set(organizationId, next);
        return next;
      }
    ),
    rows,
  };

  return {
    repository: repository as unknown as AgentConfigRepository,
    rows,
    mock: repository,
  };
};

const buildService = () => {
  const repo = buildRepository();
  const service = new AgentConfigService(repo.repository, {
    get: jest.fn().mockResolvedValue(DEFAULTS),
  });
  return { service, ...repo };
};

const write = (overrides: any = {}, secrets?: any) => ({
  expectedRevision: 0,
  overrides,
  ...(secrets ? { secrets } : {}),
});

describe('AgentConfigService', () => {
  const originalKey = process.env.POSTIZ_AI_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.POSTIZ_AI_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.POSTIZ_AI_ENCRYPTION_KEY;
    } else {
      process.env.POSTIZ_AI_ENCRYPTION_KEY = originalKey;
    }
  });

  it('returns revision zero and system credentials for an unconfigured organization', async () => {
    const { service } = buildService();

    const view = await service.getView('org-1');

    expect(view.revision).toBe(0);
    expect(view.effective.prompt).toBe('built-in prompt');
    expect(view.credentials.provider).toEqual({
      source: 'system',
      configured: true,
    });
    expect(view.credentials.langfuse.source).toBe('system');
  });

  it('creates the first revision and keeps secrets out of the view', async () => {
    const { service, rows } = buildService();

    const view = await service.save(
      'org-1',
      'user-1',
      write(
        {
          systemPrompt: 'Own rules',
          provider: { baseUrl: 'https://own.example.test/v1' },
        },
        { providerApiKey: 'sk-own', langfuse: null }
      )
    );

    expect(view.revision).toBe(1);
    expect(view.overrides.systemPrompt).toBe('Own rules');
    expect(JSON.stringify(view)).not.toContain('sk-own');
    expect(rows.get('org-1').encryptedSecrets).toEqual(expect.any(String));
    expect(rows.get('org-1').secretSummary).toEqual({
      providerApiKey: true,
      mcp: [],
      langfuse: false,
    });
    expect(view.credentials.provider).toEqual({
      source: 'organization',
      configured: true,
    });
  });

  it('rejects a write based on a stale revision', async () => {
    const { service } = buildService();
    await service.save('org-1', 'user-1', write({ systemPrompt: 'One' }));

    await expect(
      service.save('org-1', 'user-1', {
        expectedRevision: 0,
        overrides: { systemPrompt: 'Two' },
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a builtin tool outside the deployment catalog', async () => {
    const { service } = buildService();

    await expect(
      service.save('org-1', 'user-1', write({ builtinTools: ['deletePostTool'] }))
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a provider key without a provider', async () => {
    const { service } = buildService();

    await expect(
      service.save(
        'org-1',
        'user-1',
        write({}, { providerApiKey: 'sk-own' })
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a custom provider without its own key', async () => {
    const { service } = buildService();

    await expect(
      service.save(
        'org-1',
        'user-1',
        write({ provider: { baseUrl: 'https://own.example.test/v1' } })
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a custom provider with its own key', async () => {
    const { service } = buildService();

    const view = await service.save(
      'org-1',
      'user-1',
      write(
        { provider: { baseUrl: 'https://own.example.test/v1' } },
        { providerApiKey: 'sk-own' }
      )
    );

    expect(view.effective.provider.baseUrl).toBe('https://own.example.test/v1');
    expect(view.credentials.provider).toEqual({
      source: 'organization',
      configured: true,
    });
  });

  it('requires both Langfuse keys for a custom host', async () => {
    const { service } = buildService();

    await expect(
      service.save(
        'org-1',
        'user-1',
        write({ langfuse: { baseUrl: 'https://langfuse.example.test' } })
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resets overrides and credentials without deleting the row', async () => {
    const { service, rows } = buildService();
    await service.save(
      'org-1',
      'user-1',
      write(
        {
          systemPrompt: 'Own rules',
          provider: { baseUrl: 'https://own.example.test/v1' },
        },
        { providerApiKey: 'sk-own' }
      )
    );

    const view = await service.reset('org-1', 'user-1', 1);

    expect(view.revision).toBe(2);
    expect(view.overrides).toEqual({});
    expect(view.effective.prompt).toBe('built-in prompt');
    expect(rows.get('org-1').encryptedSecrets).toBeNull();
    expect(rows.get('org-1').secretSummary).toEqual({
      providerApiKey: false,
      mcp: [],
      langfuse: false,
    });
  });

  it('keeps organizations isolated', async () => {
    const { service } = buildService();
    await service.save('org-1', 'user-1', write({ systemPrompt: 'Org one' }));

    const other = await service.getView('org-2');

    expect(other.revision).toBe(0);
    expect(other.effective.prompt).toBe('built-in prompt');
  });

  it('upgrades an inherited MCP server when the organization supplies its token', async () => {
    const { service } = buildService();
    await service.save(
      'org-1',
      'user-1',
      write({}, { mcpBearerTokens: { 'shared-crm': 'org-token' } })
    );

    const resolved = await service.resolve('org-1');

    expect(resolved.config.mcpServers).toEqual([
      expect.objectContaining({
        id: 'shared-crm',
        credential: 'organization',
      }),
    ]);
    expect(resolved.secrets.mcpBearerTokens).toEqual({
      'shared-crm': 'org-token',
    });
  });

  it('rejects an MCP token that matches no server', async () => {
    const { service } = buildService();

    await expect(
      service.save(
        'org-1',
        'user-1',
        write({}, { mcpBearerTokens: { unknown: 'token' } })
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails to read stored secrets when the encryption key is missing', async () => {
    const { service } = buildService();
    await service.save(
      'org-1',
      'user-1',
      write({ provider: { baseUrl: 'https://own.example.test/v1' } }, {
        providerApiKey: 'sk-own',
      })
    );

    delete process.env.POSTIZ_AI_ENCRYPTION_KEY;

    await expect(service.resolve('org-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });
});
