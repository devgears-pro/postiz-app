import { ConflictException } from '@nestjs/common';
import { AgentConfigRepository } from '@gitroom/nestjs-libraries/database/prisma/agent-config/agent.config.repository';

const buildRepository = () => {
  const model = {
    organizationAgentConfig: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const repository = new AgentConfigRepository({ model } as any);
  return { repository, model };
};

const RECORD = {
  organizationId: 'org-1',
  schemaVersion: 1,
  revision: 2,
  overrides: { systemPrompt: 'Own rules' },
  encryptedSecrets: null,
  updatedById: 'user-1',
};

describe('AgentConfigRepository', () => {
  it('returns the stored configuration of an organization', async () => {
    const { repository, model } = buildRepository();
    model.organizationAgentConfig.findUnique.mockResolvedValue(RECORD);

    await expect(repository.find('org-1')).resolves.toEqual(RECORD);
    expect(model.organizationAgentConfig.findUnique).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
    });
  });

  it('creates the first revision of an organization configuration', async () => {
    const { repository, model } = buildRepository();
    model.organizationAgentConfig.create.mockResolvedValue({
      ...RECORD,
      revision: 1,
    });

    await repository.create({
      organizationId: 'org-1',
      overrides: { systemPrompt: 'Own rules' },
      encryptedSecrets: null,
      updatedById: 'user-1',
    });

    expect(model.organizationAgentConfig.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        schemaVersion: 1,
        revision: 1,
        overrides: { systemPrompt: 'Own rules' },
        encryptedSecrets: null,
        updatedById: 'user-1',
      },
    });
  });

  it('translates a duplicate create into a revision conflict', async () => {
    const { repository, model } = buildRepository();
    model.organizationAgentConfig.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      repository.create({
        organizationId: 'org-1',
        overrides: {},
        encryptedSecrets: null,
        updatedById: 'user-1',
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates only the expected revision and increments it', async () => {
    const { repository, model } = buildRepository();
    model.organizationAgentConfig.updateMany.mockResolvedValue({ count: 1 });
    model.organizationAgentConfig.findUnique.mockResolvedValue({
      ...RECORD,
      revision: 3,
    });

    const updated = await repository.update('org-1', 2, {
      overrides: { systemPrompt: 'New rules' },
      encryptedSecrets: null,
      updatedById: 'user-2',
    });

    expect(model.organizationAgentConfig.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', revision: 2 },
      data: {
        overrides: { systemPrompt: 'New rules' },
        encryptedSecrets: null,
        updatedById: 'user-2',
        revision: { increment: 1 },
      },
    });
    expect(updated?.revision).toBe(3);
  });

  it('rejects a stale revision', async () => {
    const { repository, model } = buildRepository();
    model.organizationAgentConfig.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.update('org-1', 1, {
        overrides: {},
        encryptedSecrets: null,
        updatedById: 'user-2',
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
