import { ConflictException, Injectable } from '@nestjs/common';
import { AgentConfigOverrides } from '@gitroom/helpers/agent/agent.config.schema';
import type { AgentSecretSummary } from '@gitroom/nestjs-libraries/chat/agent.secrets';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type AgentConfigRecord = {
  organizationId: string;
  schemaVersion: number;
  revision: number;
  overrides: AgentConfigOverrides;
  encryptedSecrets: string | null;
  secretSummary: AgentSecretSummary | null;
  updatedById: string | null;
};

export type AgentConfigWrite = {
  organizationId: string;
  overrides: AgentConfigOverrides;
  encryptedSecrets: string | null;
  secretSummary: AgentSecretSummary;
  updatedById: string | null;
};

const conflict = () =>
  new ConflictException(
    'The agent configuration changed since it was loaded. Reload it and try again.'
  );

@Injectable()
export class AgentConfigRepository {
  constructor(
    private _config: PrismaRepository<'organizationAgentConfig'>
  ) {}

  find(organizationId: string): Promise<AgentConfigRecord | null> {
    return this._config.model.organizationAgentConfig.findUnique({
      where: { organizationId },
    }) as unknown as Promise<AgentConfigRecord | null>;
  }

  async create(input: AgentConfigWrite): Promise<AgentConfigRecord> {
    try {
      return (await this._config.model.organizationAgentConfig.create({
        data: {
          organizationId: input.organizationId,
          schemaVersion: 1,
          revision: 1,
          overrides: input.overrides,
          encryptedSecrets: input.encryptedSecrets,
          secretSummary: input.secretSummary,
          updatedById: input.updatedById,
        },
      })) as unknown as AgentConfigRecord;
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw conflict();
      }
      throw error;
    }
  }

  async update(
    organizationId: string,
    expectedRevision: number,
    input: Omit<AgentConfigWrite, 'organizationId'>
  ): Promise<AgentConfigRecord | null> {
    const result = await this._config.model.organizationAgentConfig.updateMany({
      where: { organizationId, revision: expectedRevision },
      data: {
        overrides: input.overrides,
        encryptedSecrets: input.encryptedSecrets,
        secretSummary: input.secretSummary,
        updatedById: input.updatedById,
        revision: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw conflict();
    }

    return this.find(organizationId);
  }
}
