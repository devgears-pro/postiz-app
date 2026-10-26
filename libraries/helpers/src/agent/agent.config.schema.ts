import { z } from 'zod';

export const AGENT_CONFIG_LIMITS = {
  promptBytes: 64 * 1024,
  skills: 32,
  skillInstructionsBytes: 64 * 1024,
  skillReferences: 16,
  skillReferenceBytes: 64 * 1024,
  configBytes: 2 * 1024 * 1024,
  mcpServers: 8,
  mcpTimeoutMs: 60_000,
  maxSteps: 50,
  maxOutputTokens: 200_000,
} as const;

export type ConfigSource = 'builtin' | 'env' | 'file' | 'organization';

export type SkillDefinition = {
  name: string;
  description: string;
  instructions: string;
  references?: Record<string, string>;
};

export type McpServerDefinition = {
  url: string;
  description?: string;
  timeoutMs?: number;
  auth: 'none' | 'bearer';
  enabledTools: string[];
};

export type GenerationSettings = {
  maxSteps?: number;
  maxOutputTokens?: number;
  temperature?: number;
};

export type AgentConfigOverrides = {
  systemPrompt?: string;
  provider?: { baseUrl: string };
  model?: string;
  titleModel?: string;
  builtinTools?: string[];
  skills?: Record<string, SkillDefinition | null>;
  mcpServers?: Record<string, McpServerDefinition | null>;
  generation?: GenerationSettings;
};

export type SecretChanges = {
  providerApiKey?: string | null;
  mcpBearerTokens?: Record<string, string | null>;
};

export type SystemMcpServer = McpServerDefinition & {
  bearerTokenEnv?: string;
};

export type SystemAgentDefaults = {
  prompt: string;
  model: string;
  titleModel: string;
  providerBaseUrl: string;
  providerApiKeyEnv?: string;
  providerCredentialConfigured?: boolean;
  builtinTools: string[];
  allowedBuiltinTools: string[];
  skills: Record<string, SkillDefinition>;
  mcpServers: Record<string, SystemMcpServer>;
  generation: GenerationSettings;
  langfuse: {
    enabled: boolean;
    baseUrl?: string;
    publicKeyEnv?: string;
    secretKeyEnv?: string;
    allowedBaseUrls: string[];
    captureContent: boolean;
    langfuseCredentialConfigured?: boolean;
  };
  sources: Record<string, ConfigSource>;
  defaultsVersion: string;
};

export type ResolvedSkill = SkillDefinition & {
  source: ConfigSource;
};

export type ResolvedMcpServer = McpServerDefinition & {
  id: string;
  source: ConfigSource;
  credential: 'system' | 'organization' | 'none';
  bearerTokenEnv?: string;
};

export type ResolvedAgentConfig = {
  organizationId: string;
  revision: number;
  defaultsVersion: string;
  prompt: string;
  model: string;
  titleModel: string;
  provider: {
    baseUrl: string;
    credential: 'system' | 'organization';
  };
  builtinTools: string[];
  skills: ResolvedSkill[];
  mcpServers: ResolvedMcpServer[];
  generation: GenerationSettings;
  langfuse: {
    enabled: boolean;
    baseUrl?: string;
    captureContent: boolean;
  };
  sources: Record<string, ConfigSource>;
};

export type CredentialStatus = {
  provider: {
    source: 'system' | 'organization' | 'none';
    configured: boolean;
  };
  mcp: Record<string, { source: 'system' | 'organization' | 'none'; configured: boolean }>;
};

export type AgentConfigView = {
  revision: number;
  defaultsVersion: string;
  defaults: {
    prompt: string;
    model: string;
    titleModel: string;
    provider: { baseUrl: string };
    builtinTools: string[];
    skills: SkillDefinition[];
    mcpServers: Array<McpServerDefinition & { id: string }>;
    generation: GenerationSettings;
  };
  overrides: AgentConfigOverrides;
  effective: {
    prompt: string;
    model: string;
    titleModel: string;
    provider: { baseUrl: string };
    builtinTools: string[];
    skills: Array<SkillDefinition & { source: ConfigSource }>;
    mcpServers: Array<McpServerDefinition & { id: string; source: ConfigSource }>;
    generation: GenerationSettings;
  };
  sources: Record<string, ConfigSource>;
  capabilities: {
    builtinTools: string[];
  };
  credentials: CredentialStatus;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;

const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Use lowercase letters, digits and hyphens');

const referencePathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !/^[a-z][a-z0-9+.-]*:/i.test(value),
    'Reference names must be relative paths inside the skill'
  );

const httpsUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'Use an https URL');

const modelSchema = z.string().min(1).max(200);

export const skillDefinitionSchema = z
  .object({
    name: slugSchema,
    description: z.string().min(1).max(1024),
    instructions: z
      .string()
      .min(1)
      .refine(
        (value) => byteLength(value) <= AGENT_CONFIG_LIMITS.skillInstructionsBytes,
        'Skill instructions are too large'
      ),
    references: z
      .record(
        referencePathSchema,
        z
          .string()
          .refine(
            (value) =>
              byteLength(value) <= AGENT_CONFIG_LIMITS.skillReferenceBytes,
            'Reference is too large'
          )
      )
      .refine(
        (value) => Object.keys(value).length <= AGENT_CONFIG_LIMITS.skillReferences,
        'Too many references'
      )
      .optional(),
  })
  .strict();

export const mcpServerDefinitionSchema = z
  .object({
    url: httpsUrlSchema,
    description: z.string().max(500).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(AGENT_CONFIG_LIMITS.mcpTimeoutMs)
      .optional(),
    auth: z.enum(['none', 'bearer']),
    enabledTools: z.array(z.string().min(1).max(200)).max(200),
  })
  .strict();

export const generationSettingsSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(AGENT_CONFIG_LIMITS.maxSteps).optional(),
    maxOutputTokens: z
      .number()
      .int()
      .min(1)
      .max(AGENT_CONFIG_LIMITS.maxOutputTokens)
      .optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();

export const agentConfigOverridesSchema = z
  .object({
    systemPrompt: z
      .string()
      .refine(
        (value) => byteLength(value) <= AGENT_CONFIG_LIMITS.promptBytes,
        'Prompt is too large'
      )
      .optional(),
    provider: z.object({ baseUrl: httpsUrlSchema }).strict().optional(),
    model: modelSchema.optional(),
    titleModel: modelSchema.optional(),
    builtinTools: z.array(z.string().min(1).max(100)).max(64).optional(),
    skills: z.record(slugSchema, skillDefinitionSchema.nullable()).optional(),
    mcpServers: z.record(slugSchema, mcpServerDefinitionSchema.nullable()).optional(),
    generation: generationSettingsSchema.optional(),
  })
  .strict()
  .refine(
    (value) => byteLength(JSON.stringify(value)) <= AGENT_CONFIG_LIMITS.configBytes,
    'Agent configuration is too large'
  );

export const secretChangesSchema = z
  .object({
    providerApiKey: z.string().min(1).max(4096).nullable().optional(),
    mcpBearerTokens: z
      .record(slugSchema, z.string().min(1).max(4096).nullable())
      .optional(),
  })
  .strict();

export const agentConfigWriteRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    overrides: agentConfigOverridesSchema,
    secrets: secretChangesSchema.optional(),
  })
  .strict();

export type AgentConfigWriteRequest = {
  expectedRevision: number;
  overrides: AgentConfigOverrides;
  secrets?: SecretChanges;
};

export const resetAgentConfigSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
  })
  .strict();

export const providerTestInputSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    provider: z.object({ baseUrl: httpsUrlSchema }).strict().optional(),
    model: modelSchema.optional(),
    apiKey: z.string().min(1).max(4096).optional(),
  })
  .strict();

export const mcpTestInputSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    serverId: slugSchema,
    server: mcpServerDefinitionSchema.omit({ enabledTools: true }),
    bearerToken: z.string().min(1).max(4096).optional(),
  })
  .strict();

export type ProviderTestInput = {
  expectedRevision: number;
  provider?: { baseUrl: string };
  model?: string;
  apiKey?: string;
};

export type McpTestInput = {
  expectedRevision: number;
  serverId: string;
  server: Omit<McpServerDefinition, 'enabledTools'>;
  bearerToken?: string;
};

export const emptyAgentConfigOverrides = (): AgentConfigOverrides => ({});

export function validateOverrides(
  defaults: SystemAgentDefaults,
  overrides: AgentConfigOverrides
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const skillNames = new Set([
    ...Object.keys(defaults.skills),
    ...Object.keys(overrides.skills ?? {}),
  ]);
  let enabledSkills = 0;
  for (const name of skillNames) {
    if (overrides.skills?.[name] === null) continue;
    enabledSkills += 1;
  }
  if (enabledSkills > AGENT_CONFIG_LIMITS.skills) {
    issues.push({
      path: 'skills',
      message: `At most ${AGENT_CONFIG_LIMITS.skills} skills can be enabled`,
    });
  }

  const mcpNames = new Set([
    ...Object.keys(defaults.mcpServers),
    ...Object.keys(overrides.mcpServers ?? {}),
  ]);
  let enabledMcp = 0;
  for (const name of mcpNames) {
    if (overrides.mcpServers?.[name] === null) continue;
    enabledMcp += 1;
  }
  if (enabledMcp > AGENT_CONFIG_LIMITS.mcpServers) {
    issues.push({
      path: 'mcpServers',
      message: `At most ${AGENT_CONFIG_LIMITS.mcpServers} MCP servers can be enabled`,
    });
  }

  const allowed = new Set(defaults.allowedBuiltinTools);
  for (const tool of overrides.builtinTools ?? []) {
    if (!allowed.has(tool)) {
      issues.push({
        path: 'builtinTools',
        message: `${tool} is not available on this deployment`,
      });
    }
  }

  const providerBaseUrl = overrides.provider?.baseUrl;
  if (providerBaseUrl && overrides.provider && !providerBaseUrl.startsWith('https://')) {
    issues.push({
      path: 'provider.baseUrl',
      message: 'Use an https provider URL',
    });
  }

  return issues;
}

const mergeSkills = (
  defaults: SystemAgentDefaults,
  overrides: AgentConfigOverrides
): ResolvedSkill[] => {
  const names = new Set([
    ...Object.keys(defaults.skills),
    ...Object.keys(overrides.skills ?? {}),
  ]);

  return [...names]
    .sort()
    .flatMap((name) => {
      const local = overrides.skills?.[name];
      if (local === null) return [];
      if (local) {
        return [{ ...local, source: 'organization' as ConfigSource }];
      }
      const shared = defaults.skills[name];
      if (!shared) return [];
      return [
        {
          ...shared,
          source: defaults.sources.skills ?? ('builtin' as ConfigSource),
        },
      ];
    });
};

const mergeMcpServers = (
  defaults: SystemAgentDefaults,
  overrides: AgentConfigOverrides
): ResolvedMcpServer[] => {
  const names = new Set([
    ...Object.keys(defaults.mcpServers),
    ...Object.keys(overrides.mcpServers ?? {}),
  ]);

  return [...names].sort().flatMap((id): ResolvedMcpServer[] => {
    const local = overrides.mcpServers?.[id];
    if (local === null) return [];
    if (local) {
      return [
        {
          ...local,
          id,
          source: 'organization',
          credential: local.auth === 'bearer' ? 'organization' : 'none',
        },
      ];
    }
    const shared = defaults.mcpServers[id];
    if (!shared) return [];
    const { bearerTokenEnv, ...server } = shared;
    return [
      {
        ...server,
        id,
        bearerTokenEnv,
        source: defaults.sources.mcpServers ?? 'builtin',
        credential:
          server.auth === 'bearer'
            ? bearerTokenEnv
              ? 'system'
              : 'none'
            : 'none',
      },
    ];
  });
};

const mergeGeneration = (
  defaults: GenerationSettings,
  overrides: GenerationSettings | undefined
): GenerationSettings => {
  const merged: GenerationSettings = { ...defaults };
  if (!overrides) return merged;
  if (overrides.maxSteps !== undefined) merged.maxSteps = overrides.maxSteps;
  if (overrides.maxOutputTokens !== undefined) {
    merged.maxOutputTokens = overrides.maxOutputTokens;
  }
  if (overrides.temperature !== undefined) merged.temperature = overrides.temperature;
  return merged;
};

export function resolveAgentConfig(
  defaults: SystemAgentDefaults,
  overrides: AgentConfigOverrides,
  organizationId: string,
  revision: number
): ResolvedAgentConfig {
  const model = overrides.model ?? defaults.model;
  const titleModel = overrides.titleModel ?? overrides.model ?? defaults.titleModel;
  const builtinTools = overrides.builtinTools ?? defaults.builtinTools;
  const generation = mergeGeneration(defaults.generation, overrides.generation);

  const sources: Record<string, ConfigSource> = {
    prompt: overrides.systemPrompt !== undefined
      ? 'organization'
      : defaults.sources.prompt,
    model: overrides.model !== undefined ? 'organization' : defaults.sources.model,
    titleModel:
      overrides.titleModel !== undefined
        ? 'organization'
        : overrides.model !== undefined
          ? 'organization'
          : defaults.sources.titleModel,
    provider:
      overrides.provider !== undefined
        ? 'organization'
        : defaults.sources.providerBaseUrl,
    builtinTools:
      overrides.builtinTools !== undefined
        ? 'organization'
        : defaults.sources.builtinTools,
    generation: overrides.generation ? 'organization' : defaults.sources.generation,
    langfuse: defaults.sources.langfuse,
    skills: overrides.skills ? 'organization' : (defaults.sources.skills ?? 'builtin'),
    mcpServers: overrides.mcpServers
      ? 'organization'
      : (defaults.sources.mcpServers ?? 'builtin'),
  };

  return {
    organizationId,
    revision,
    defaultsVersion: defaults.defaultsVersion,
    prompt: overrides.systemPrompt ?? defaults.prompt,
    model,
    titleModel,
    provider: {
      baseUrl: overrides.provider?.baseUrl ?? defaults.providerBaseUrl,
      credential: overrides.provider ? 'organization' : 'system',
    },
    builtinTools,
    skills: mergeSkills(defaults, overrides),
    mcpServers: mergeMcpServers(defaults, overrides),
    generation,
    langfuse: {
      enabled: defaults.langfuse.enabled,
      baseUrl: defaults.langfuse.baseUrl,
      captureContent: defaults.langfuse.captureContent,
    },
    sources,
  };
}

const sharedSkills = (defaults: SystemAgentDefaults) =>
  Object.entries(defaults.skills)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, skill]) => ({ ...skill }));

const sharedMcpServers = (defaults: SystemAgentDefaults) =>
  Object.entries(defaults.mcpServers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, { bearerTokenEnv, ...server }]) => ({ ...server, id }));

export function toAgentConfigView(
  defaults: SystemAgentDefaults,
  overrides: AgentConfigOverrides,
  revision: number,
  credentials: CredentialStatus
): AgentConfigView {
  const resolved = resolveAgentConfig(defaults, overrides, '', revision);

  return {
    revision,
    defaultsVersion: defaults.defaultsVersion,
    defaults: {
      prompt: defaults.prompt,
      model: defaults.model,
      titleModel: defaults.titleModel,
      provider: { baseUrl: defaults.providerBaseUrl },
      builtinTools: [...defaults.builtinTools],
      skills: sharedSkills(defaults),
      mcpServers: sharedMcpServers(defaults),
      generation: { ...defaults.generation },
    },
    overrides,
    effective: {
      prompt: resolved.prompt,
      model: resolved.model,
      titleModel: resolved.titleModel,
      provider: { baseUrl: resolved.provider.baseUrl },
      builtinTools: resolved.builtinTools,
      skills: resolved.skills,
      mcpServers: resolved.mcpServers.map(
        ({ credential, bearerTokenEnv, ...server }) => server
      ),
      generation: resolved.generation,
    },
    sources: resolved.sources,
    capabilities: {
      builtinTools: [...defaults.allowedBuiltinTools],
    },
    credentials,
  };
}
