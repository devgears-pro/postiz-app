import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { AgentConfigRepository } from '@gitroom/nestjs-libraries/database/prisma/agent-config/agent.config.repository';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import {
  decryptAgentSecrets,
  encryptAgentSecrets,
} from '@gitroom/nestjs-libraries/chat/agent.secrets';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';

const databaseUrl = process.env.POSTIZ_AGENT_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const DEFAULTS: SystemAgentDefaults = {
  prompt: 'built-in prompt',
  model: 'system-model',
  titleModel: 'system-title',
  providerBaseUrl: 'https://llm.example.test/v1',
  providerApiKeyEnv: 'OPENAI_API_KEY',
  builtinTools: ['integrationList'],
  allowedBuiltinTools: ['integrationList'],
  skills: {},
  mcpServers: {},
  generation: {},
  langfuse: {
    enabled: false,
    allowedBaseUrls: [],
    captureContent: false,
  },
  sources: { prompt: 'builtin' },
  defaultsVersion: 'integration-v1',
};

describeDatabase('OrganizationAgentConfig against PostgreSQL', () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl ?? 'postgresql://skipped:skipped@127.0.0.1:1/skipped',
      },
    },
  });
  const repository = new AgentConfigRepository({ model: prisma } as any);
  const service = new AgentConfigService(repository, {
    get: async () => DEFAULTS,
  });
  const createdOrganizations: string[] = [];

  const createOrganization = async (name: string) => {
    const organization = await prisma.organization.create({
      data: { name },
    });
    createdOrganizations.push(organization.id);
    return organization.id;
  };

  beforeAll(async () => {
    process.env.POSTIZ_AI_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.organizationAgentConfig.deleteMany({
      where: { organizationId: { in: createdOrganizations } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrganizations } },
    });
    await prisma.$disconnect();
  });

  it('creates the first revision and rejects a duplicate create', async () => {
    const organizationId = await createOrganization('Agent integration A');

    const created = await repository.create({
      organizationId,
      overrides: { systemPrompt: 'Own rules' },
      encryptedSecrets: null,
      secretSummary: { providerApiKey: false, mcp: [], langfuse: false },
      updatedById: null,
    });

    expect(created.revision).toBe(1);
    await expect(
      repository.create({
        organizationId,
        overrides: {},
        encryptedSecrets: null,
        secretSummary: { providerApiKey: false, mcp: [], langfuse: false },
        updatedById: null,
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a stale update and isolates organizations', async () => {
    const first = await createOrganization('Agent integration B');
    const second = await createOrganization('Agent integration C');

    await service.save(first, null, {
      expectedRevision: 0,
      overrides: { systemPrompt: 'First organization' },
    });

    await expect(
      service.save(first, null, {
        expectedRevision: 0,
        overrides: { systemPrompt: 'Stale write' },
      })
    ).rejects.toBeInstanceOf(ConflictException);

    const otherView = await service.getView(second);
    expect(otherView.revision).toBe(0);
    expect(otherView.effective.prompt).toBe('built-in prompt');
  });

  it('round-trips encrypted credentials per organization', async () => {
    const first = await createOrganization('Agent integration D');
    const second = await createOrganization('Agent integration E');

    const view = await service.save(first, null, {
      expectedRevision: 0,
      overrides: { provider: { baseUrl: 'https://own.example.test/v1' } },
      secrets: { providerApiKey: 'sk-integration' },
    });

    expect(view.credentials.provider).toEqual({
      source: 'organization',
      configured: true,
    });

    const row = await repository.find(first);
    const key = Buffer.from(process.env.POSTIZ_AI_ENCRYPTION_KEY!, 'base64');

    expect(
      decryptAgentSecrets(first, row!.encryptedSecrets!, key)
    ).toEqual({ providerApiKey: 'sk-integration' });

    expect(() =>
      decryptAgentSecrets(second, row!.encryptedSecrets!, key)
    ).toThrow();

    const resolved = await service.resolve(first);
    expect(resolved.secrets.providerApiKey).toBe('sk-integration');
  });
});
