import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgentConfigController } from '@gitroom/backend/api/routes/agent.config.controller';

const VIEW = {
  revision: 3,
  defaultsVersion: 'defaults-v1',
  defaults: { prompt: 'built-in' },
  overrides: {},
  effective: { prompt: 'built-in' },
  sources: { prompt: 'builtin' },
  capabilities: { builtinTools: [], langfuseBaseUrls: [] },
  credentials: {
    provider: { source: 'system', configured: true },
    mcp: {},
    langfuse: { source: 'none', configured: false },
  },
};

const buildController = () => {
  const service = {
    getView: jest.fn().mockResolvedValue(VIEW),
    save: jest.fn().mockResolvedValue(VIEW),
    reset: jest.fn().mockResolvedValue(VIEW),
  };
  const connections = {
    testProvider: jest.fn().mockResolvedValue({ ok: true, model: 'm' }),
    testMcp: jest.fn().mockResolvedValue({ ok: true, tools: [], errors: {} }),
  };
  const controller = new AgentConfigController(
    service as any,
    connections as any
  );
  return { controller, service, connections };
};

const ORG = { id: 'org-1' } as any;
const USER = { id: 'user-1' } as any;

describe('AgentConfigController', () => {
  it('returns the organization view', async () => {
    const { controller, service } = buildController();

    await expect(controller.get(ORG)).resolves.toEqual(VIEW);
    expect(service.getView).toHaveBeenCalledWith('org-1');
  });

  it('rejects a body with unknown fields', async () => {
    const { controller, service } = buildController();

    await expect(
      controller.save(ORG, USER, {
        expectedRevision: 0,
        overrides: {},
        organizationId: 'org-2',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.save).not.toHaveBeenCalled();
  });

  it('saves a valid body with the authenticated user id', async () => {
    const { controller, service } = buildController();

    await controller.save(ORG, USER, {
      expectedRevision: 3,
      overrides: { systemPrompt: 'Own rules' },
      secrets: { providerApiKey: 'sk-own' },
    });

    expect(service.save).toHaveBeenCalledWith('org-1', 'user-1', {
      expectedRevision: 3,
      overrides: { systemPrompt: 'Own rules' },
      secrets: { providerApiKey: 'sk-own' },
    });
  });

  it('accepts an empty prompt override', async () => {
    const { controller, service } = buildController();

    await controller.save(ORG, USER, {
      expectedRevision: 3,
      overrides: { systemPrompt: '' },
    });

    expect(service.save).toHaveBeenCalledWith('org-1', 'user-1', {
      expectedRevision: 3,
      overrides: { systemPrompt: '' },
    });
  });

  it('resets with the expected revision', async () => {
    const { controller, service } = buildController();

    await controller.reset(ORG, USER, { expectedRevision: 2 });

    expect(service.reset).toHaveBeenCalledWith('org-1', 'user-1', 2);
  });

  it('rejects a reset without a revision', async () => {
    const { controller } = buildController();

    await expect(
      controller.reset(ORG, USER, {} as any)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a Langfuse override from the organization', async () => {
    const { controller, service } = buildController();

    await expect(
      controller.save(ORG, USER, {
        expectedRevision: 3,
        overrides: { langfuse: { enabled: false } },
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.save).not.toHaveBeenCalled();
  });

  it('tests a provider only against the loaded revision', async () => {
    const { controller, connections } = buildController();

    await controller.testProvider(ORG, {
      expectedRevision: 3,
      model: 'org-model',
    });

    expect(connections.testProvider).toHaveBeenCalledWith('org-1', {
      expectedRevision: 3,
      model: 'org-model',
    });
  });

  it('rejects a test request from a stale revision', async () => {
    const { controller, connections } = buildController();

    await expect(
      controller.testProvider(ORG, { expectedRevision: 2 })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(connections.testProvider).not.toHaveBeenCalled();
  });

  it('tests an MCP server without invoking its tools', async () => {
    const { controller, connections } = buildController();

    await controller.testMcp(ORG, {
      expectedRevision: 3,
      serverId: 'crm',
      server: {
        url: 'https://crm.example.test/mcp',
        auth: 'bearer',
      },
    });

    expect(connections.testMcp).toHaveBeenCalledWith('org-1', {
      expectedRevision: 3,
      serverId: 'crm',
      server: {
        url: 'https://crm.example.test/mcp',
        auth: 'bearer',
      },
    });
  });
});
