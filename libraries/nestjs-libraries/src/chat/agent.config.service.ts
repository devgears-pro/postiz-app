import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  agentConfigOverridesSchema,
  resolveAgentConfig,
  toAgentConfigView,
  validateOverrides,
  type AgentConfigOverrides,
  type AgentConfigView,
  type AgentConfigWriteRequest,
  type CredentialStatus,
  type ResolvedAgentConfig,
  type SecretChanges,
  type SystemAgentDefaults,
} from '@gitroom/helpers/agent/agent.config.schema';
import {
  decryptAgentSecrets,
  encryptAgentSecrets,
  isEmptyAgentSecrets,
  loadAgentEncryptionKey,
  summarizeAgentSecrets,
  type AgentSecrets,
  type AgentSecretSummary,
} from '@gitroom/nestjs-libraries/chat/agent.secrets';
import {
  AgentConfigRepository,
  type AgentConfigRecord,
} from '@gitroom/nestjs-libraries/database/prisma/agent-config/agent.config.repository';
import {
  AGENT_DEFAULTS,
  type AgentDefaultsProvider,
} from '@gitroom/nestjs-libraries/chat/agent.defaults.token';

export type ResolvedAgentBundle = {
  config: ResolvedAgentConfig;
  secrets: AgentSecrets;
  defaults: SystemAgentDefaults;
};

const emptySummary = (): AgentSecretSummary => ({
  providerApiKey: false,
  mcp: [],
  langfuse: false,
});

const readOverrides = (record: AgentConfigRecord | null): AgentConfigOverrides => {
  if (!record) return {};
  return agentConfigOverridesSchema.parse(
    record.overrides ?? {}
  ) as AgentConfigOverrides;
};

const encryptionKey = () => {
  const key = loadAgentEncryptionKey(process.env);
  if (!key) {
    throw new ServiceUnavailableException(
      'POSTIZ_AI_ENCRYPTION_KEY is not configured'
    );
  }
  return key;
};

const applySecretChanges = (
  current: AgentSecrets,
  changes: SecretChanges | undefined
): AgentSecrets => {
  if (!changes) return current;

  const next: AgentSecrets = {
    ...current,
    ...(current.mcpBearerTokens
      ? { mcpBearerTokens: { ...current.mcpBearerTokens } }
      : {}),
    ...(current.langfuse ? { langfuse: { ...current.langfuse } } : {}),
  };

  if (changes.providerApiKey === null) {
    delete next.providerApiKey;
  } else if (changes.providerApiKey !== undefined) {
    next.providerApiKey = changes.providerApiKey;
  }

  for (const [id, token] of Object.entries(changes.mcpBearerTokens ?? {})) {
    if (token === null) {
      delete next.mcpBearerTokens?.[id];
    } else {
      next.mcpBearerTokens = { ...(next.mcpBearerTokens ?? {}), [id]: token };
    }
  }
  if (next.mcpBearerTokens && Object.keys(next.mcpBearerTokens).length === 0) {
    delete next.mcpBearerTokens;
  }

  if (changes.langfuse) {
    const publicKey =
      changes.langfuse.publicKey === undefined
        ? next.langfuse?.publicKey
        : (changes.langfuse.publicKey ?? undefined);
    const secretKey =
      changes.langfuse.secretKey === undefined
        ? next.langfuse?.secretKey
        : (changes.langfuse.secretKey ?? undefined);

    if (publicKey && secretKey) {
      next.langfuse = { publicKey, secretKey };
    } else {
      delete next.langfuse;
    }
  }

  return next;
};

@Injectable()
export class AgentConfigService {
  constructor(
    private _repository: AgentConfigRepository,
    @Inject(AGENT_DEFAULTS) private _defaults: AgentDefaultsProvider
  ) {}

  async resolve(organizationId: string): Promise<ResolvedAgentBundle> {
    const [defaults, record] = await Promise.all([
      this._defaults.get(),
      this._repository.find(organizationId),
    ]);

    const overrides = readOverrides(record);
    const config = resolveAgentConfig(
      defaults,
      overrides,
      organizationId,
      record?.revision ?? 0
    );

    let secrets: AgentSecrets = {};
    if (record?.encryptedSecrets) {
      secrets = decryptAgentSecrets(
        organizationId,
        record.encryptedSecrets,
        encryptionKey()
      );
    }

    return {
      defaults,
      secrets,
      config: this.applyRuntimeCredentials(config, secrets),
    };
  }

  async getView(organizationId: string): Promise<AgentConfigView> {
    const [defaults, record] = await Promise.all([
      this._defaults.get(),
      this._repository.find(organizationId),
    ]);

    return this.buildView(defaults, record);
  }

  async save(
    organizationId: string,
    userId: string | null,
    input: AgentConfigWriteRequest
  ): Promise<AgentConfigView> {
    const [defaults, record] = await Promise.all([
      this._defaults.get(),
      this._repository.find(organizationId),
    ]);

    const revision = record?.revision ?? 0;
    if (input.expectedRevision !== revision) {
      throw new ConflictException(
        'The agent configuration changed since it was loaded. Reload it and try again.'
      );
    }

    const issues = validateOverrides(defaults, input.overrides);
    if (issues.length) {
      throw new BadRequestException({ message: 'Invalid agent configuration', issues });
    }

    const currentSecrets = record?.encryptedSecrets
      ? decryptAgentSecrets(
          organizationId,
          record.encryptedSecrets,
          encryptionKey()
        )
      : {};

    const secrets = applySecretChanges(currentSecrets, input.secrets);
    const config = resolveAgentConfig(
      defaults,
      input.overrides,
      organizationId,
      revision
    );
    this.assertCredentialsMatch(config, secrets);

    const encryptedSecrets = isEmptyAgentSecrets(secrets)
      ? null
      : encryptAgentSecrets(organizationId, secrets, encryptionKey());
    const secretSummary = summarizeAgentSecrets(secrets);

    const saved = record
      ? await this._repository.update(organizationId, revision, {
          overrides: input.overrides,
          encryptedSecrets,
          secretSummary,
          updatedById: userId,
        })
      : await this._repository.create({
          organizationId,
          overrides: input.overrides,
          encryptedSecrets,
          secretSummary,
          updatedById: userId,
        });

    return this.buildView(defaults, saved);
  }

  async reset(
    organizationId: string,
    userId: string | null,
    expectedRevision: number
  ): Promise<AgentConfigView> {
    const [defaults, record] = await Promise.all([
      this._defaults.get(),
      this._repository.find(organizationId),
    ]);

    const revision = record?.revision ?? 0;
    if (expectedRevision !== revision) {
      throw new ConflictException(
        'The agent configuration changed since it was loaded. Reload it and try again.'
      );
    }

    const write = {
      overrides: {},
      encryptedSecrets: null,
      secretSummary: emptySummary(),
      updatedById: userId,
    };

    const saved = record
      ? await this._repository.update(organizationId, revision, write)
      : await this._repository.create({ organizationId, ...write });

    return this.buildView(defaults, saved);
  }

  private applyRuntimeCredentials(
    config: ResolvedAgentConfig,
    secrets: AgentSecrets
  ): ResolvedAgentConfig {
    return {
      ...config,
      mcpServers: config.mcpServers.map((server) =>
        server.credential === 'system' && secrets.mcpBearerTokens?.[server.id]
          ? { ...server, credential: 'organization' as const }
          : server
      ),
    };
  }

  private assertCredentialsMatch(
    config: ResolvedAgentConfig,
    secrets: AgentSecrets
  ): void {
    if (config.provider.credential === 'organization' && !secrets.providerApiKey) {
      throw new BadRequestException({
        message:
          'A custom provider requires its own API key; the deployment key is never sent to another endpoint',
      });
    }

    if (config.provider.credential === 'system' && secrets.providerApiKey) {
      throw new BadRequestException({
        message:
          'Set a provider URL before adding your own provider API key',
      });
    }

    if (config.langfuse.credential === 'organization' && !secrets.langfuse) {
      throw new BadRequestException({
        message: 'A custom Langfuse host requires both Langfuse keys',
      });
    }

    if (config.langfuse.credential !== 'organization' && secrets.langfuse) {
      throw new BadRequestException({
        message:
          'Set a custom Langfuse host before adding your own Langfuse keys',
      });
    }

    const serverIds = new Set(config.mcpServers.map((server) => server.id));
    for (const id of Object.keys(secrets.mcpBearerTokens ?? {})) {
      if (!serverIds.has(id)) {
        throw new BadRequestException({
          message: `MCP token ${id} does not match any configured server`,
        });
      }
    }

    for (const server of config.mcpServers) {
      if (server.credential === 'organization' && !secrets.mcpBearerTokens?.[server.id]) {
        throw new BadRequestException({
          message: `MCP server ${server.id} requires a bearer token`,
        });
      }
    }
  }

  private buildView(
    defaults: SystemAgentDefaults,
    record: AgentConfigRecord | null
  ): AgentConfigView {
    const overrides = readOverrides(record);
    const revision = record?.revision ?? 0;
    const summary = record?.secretSummary ?? emptySummary();
    const resolved = resolveAgentConfig(defaults, overrides, '', revision);

    const credentials: CredentialStatus = {
      provider:
        resolved.provider.credential === 'organization'
          ? { source: 'organization', configured: summary.providerApiKey }
          : {
              source: defaults.providerApiKeyEnv ? 'system' : 'none',
              configured: Boolean(defaults.providerCredentialConfigured),
            },
      mcp: Object.fromEntries(
        resolved.mcpServers.map((server) => [
          server.id,
          {
            source: server.credential,
            configured:
              server.credential === 'none'
                ? false
                : server.credential === 'system'
                  ? true
                  : summary.mcp.includes(server.id),
          },
        ])
      ),
      langfuse: {
        source: resolved.langfuse.credential,
        configured:
          resolved.langfuse.credential === 'system'
            ? Boolean(defaults.langfuse.langfuseCredentialConfigured)
            : resolved.langfuse.credential === 'organization'
              ? summary.langfuse
              : false,
      },
    };

    return toAgentConfigView(defaults, overrides, revision, credentials);
  }
}
