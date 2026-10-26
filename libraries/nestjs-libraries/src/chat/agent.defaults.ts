import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { z } from 'zod';
import {
  AGENT_CONFIG_LIMITS,
  generationSettingsSchema,
  type ConfigSource,
  type SkillDefinition,
  type SystemAgentDefaults,
  type SystemMcpServer,
} from '@gitroom/helpers/agent/agent.config.schema';
import {
  BUILTIN_SYSTEM_PROMPT,
} from '@gitroom/nestjs-libraries/chat/agent.prompt';

const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_PROVIDER_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TITLE_MODEL = DEFAULT_MODEL;

export type AgentEnv = Readonly<Record<string, string | undefined>>;

const httpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'Use an https URL');

const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Use lowercase letters, digits and hyphens');

const rootMcpServerSchema = z
  .object({
    url: httpsUrl,
    description: z.string().max(500).optional(),
    timeoutMs: z.number().int().min(1000).max(AGENT_CONFIG_LIMITS.mcpTimeoutMs).optional(),
    auth: z.enum(['none', 'bearer']),
    bearerTokenEnv: z.string().min(1).max(200).optional(),
    enabledTools: z.array(z.string().min(1).max(200)).max(200),
  })
  .strict();

const rootAgentConfigSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    promptFile: z.string().min(1).max(200).optional(),
    prompt: z.string().min(1).optional(),
    skills: z.array(z.string().min(1).max(300)).max(64).optional(),
    model: z.string().min(1).max(200).optional(),
    titleModel: z.string().min(1).max(200).optional(),
    provider: z
      .object({
        baseUrl: httpsUrl,
        apiKeyEnv: z.string().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
    builtinTools: z.array(z.string().min(1).max(100)).max(64).optional(),
    allowedBuiltinTools: z.array(z.string().min(1).max(100)).max(64).optional(),
    mcpServers: z.record(slugSchema, rootMcpServerSchema).optional(),
    generation: generationSettingsSchema.optional(),
    langfuse: z
      .object({
        enabled: z.boolean().optional(),
        baseUrl: httpsUrl.optional(),
        publicKeyEnv: z.string().min(1).max(200).optional(),
        secretKeyEnv: z.string().min(1).max(200).optional(),
        allowedBaseUrls: z.array(httpsUrl).max(16).optional(),
        captureContent: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

type RootAgentConfig = z.infer<typeof rootAgentConfigSchema>;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const readNumber = (
  env: AgentEnv,
  name: string,
  bounds: { min: number; max: number }
): number | undefined => {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
    throw new Error(`${name} must be a number between ${bounds.min} and ${bounds.max}`);
  }
  return value;
};

const ensureInsideRoot = async (
  root: string,
  relativePath: string,
  expect: 'file' | 'directory'
): Promise<string> => {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`Configuration paths must stay inside the shared root: ${relativePath}`);
  }

  const rootReal = await realpath(root);
  let targetReal: string;
  try {
    targetReal = await realpath(join(rootReal, relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw error;
    throw new Error(`Cannot read ${relativePath} inside the shared root`);
  }

  const inside =
    targetReal === rootReal || targetReal.startsWith(rootReal + sep);
  if (!inside) {
    throw new Error(`Configuration paths must stay inside the shared root: ${relativePath}`);
  }

  const info = await stat(targetReal);
  if (expect === 'file' ? !info.isFile() : !info.isDirectory()) {
    throw new Error(`${relativePath} must be a ${expect} inside the shared root`);
  }

  return targetReal;
};

const readOptionalFile = async (
  root: string,
  relativePath: string
): Promise<string | undefined> => {
  try {
    const file = await ensureInsideRoot(root, relativePath, 'file');
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw error;
  }
};

const listSkillDirectories = async (root: string, relativePath: string) => {
  const directory = await ensureInsideRoot(root, relativePath, 'directory');
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(relativePath, entry.name));
};

const parseSkillFile = (raw: string, expectedName: string): SkillDefinition => {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Skill ${expectedName} is missing frontmatter`);
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  const name = fields.name ?? expectedName;
  const description = fields.description;
  const instructions = match[2].trim();

  if (name !== expectedName) {
    throw new Error(`Skill ${expectedName} declares a different name: ${name}`);
  }
  if (!description) {
    throw new Error(`Skill ${expectedName} is missing a description`);
  }
  if (!instructions) {
    throw new Error(`Skill ${expectedName} has no instructions`);
  }
  if (instructions.length > AGENT_CONFIG_LIMITS.skillInstructionsBytes) {
    throw new Error(`Skill ${expectedName} is too large`);
  }

  return { name, description, instructions };
};

const readSkillReferences = async (
  skillDirectory: string
): Promise<Record<string, string> | undefined> => {
  const referencesDirectory = join(skillDirectory, 'references');
  let entries: Dirent[];
  try {
    entries = await readdir(referencesDirectory, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const files = entries.filter((entry) => entry.isFile()).slice(0, AGENT_CONFIG_LIMITS.skillReferences);
  const references: Record<string, string> = {};
  for (const file of files) {
    const content = await readFile(join(referencesDirectory, file.name), 'utf8');
    if (content.length > AGENT_CONFIG_LIMITS.skillReferenceBytes) {
      throw new Error(`Skill reference ${file.name} is too large`);
    }
    references[file.name] = content;
  }

  return Object.keys(references).length ? references : undefined;
};

const loadFileSkills = async (
  root: string,
  paths: string[]
): Promise<Record<string, SkillDefinition>> => {
  const skillDirectories: string[] = [];

  for (const path of paths) {
    if (path.endsWith('SKILL.md')) {
      skillDirectories.push(path.slice(0, -'SKILL.md'.length).replace(/\/$/, ''));
      continue;
    }

    const directory = await ensureInsideRoot(root, path, 'directory');
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === 'SKILL.md')) {
      skillDirectories.push(path);
      continue;
    }
    skillDirectories.push(...(await listSkillDirectories(root, path)));
  }

  const skills: Record<string, SkillDefinition> = {};
  for (const path of skillDirectories) {
    const name = path.split('/').filter(Boolean).pop()!;
    const skillFile = await ensureInsideRoot(root, join(path, 'SKILL.md'), 'file');
    const raw = await readFile(skillFile, 'utf8');
    const skill = parseSkillFile(raw, name);
    const references = await readSkillReferences(join(skillFile, '..'));
    skills[name] = references ? { ...skill, references } : skill;
  }

  return skills;
};

const pickPrompt = async (
  env: AgentEnv,
  root: string | undefined,
  config: RootAgentConfig
): Promise<{ prompt: string; source: ConfigSource }> => {
  if (config.prompt && config.promptFile) {
    throw new Error('agent.json must set either prompt or promptFile, not both');
  }

  const promptFile = config.promptFile ?? env.POSTIZ_AI_PROMPT_FILE;
  if (promptFile) {
    if (!root) {
      throw new Error('POSTIZ_AI_PROMPT_FILE requires POSTIZ_AI_CONFIG_DIR');
    }
    const prompt = await readOptionalFile(root, promptFile);
    if (prompt === undefined) {
      throw new Error(`Prompt file ${promptFile} was not found inside the shared root`);
    }
    return { prompt, source: 'file' };
  }

  if (config.prompt) {
    return { prompt: config.prompt, source: 'file' };
  }

  return { prompt: BUILTIN_SYSTEM_PROMPT, source: 'builtin' };
};

const versionHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export async function loadAgentDefaults(
  env: AgentEnv,
  options: { toolCatalog: string[] }
): Promise<SystemAgentDefaults> {
  const configDir = env.POSTIZ_AI_CONFIG_DIR?.trim();
  const root = configDir ? await realpath(configDir).catch(() => {
    throw new Error(`POSTIZ_AI_CONFIG_DIR does not exist: ${configDir}`);
  }) : undefined;

  let config: RootAgentConfig = {};
  if (root) {
    const raw = await readOptionalFile(root, 'agent.json');
    if (raw !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('agent.json is not valid JSON');
      }
      const result = rootAgentConfigSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`agent.json is invalid: ${result.error.message}`);
      }
      config = result.data;
    }
  }

  const catalog = [...options.toolCatalog];
  const prompt = await pickPrompt(env, root, config);

  const model = config.model ?? env.POSTIZ_AI_MODEL?.trim() ?? DEFAULT_MODEL;
  const titleModel =
    config.titleModel ??
    env.POSTIZ_AI_TITLE_MODEL?.trim() ??
    (config.model || env.POSTIZ_AI_MODEL ? model : DEFAULT_TITLE_MODEL);

  const providerBaseUrl = trimTrailingSlash(
    config.provider?.baseUrl ??
      env.OPENAI_BASE_URL?.trim() ??
      DEFAULT_PROVIDER_BASE_URL
  );
  const providerApiKeyEnv = config.provider?.apiKeyEnv ?? 'OPENAI_API_KEY';

  let skills: Record<string, SkillDefinition> = {};
  let skillsSource: ConfigSource = 'builtin';
  const skillPaths = config.skills ??
    (env.POSTIZ_AI_SKILLS_DIR?.trim() ? [env.POSTIZ_AI_SKILLS_DIR.trim()] : undefined);
  if (skillPaths?.length) {
    if (!root) {
      throw new Error('Shared skills require POSTIZ_AI_CONFIG_DIR');
    }
    skills = await loadFileSkills(root, skillPaths);
    skillsSource = 'file';
  }

  const generation = {
    ...config.generation,
    maxSteps:
      config.generation?.maxSteps ??
      readNumber(env, 'POSTIZ_AI_MAX_STEPS', { min: 1, max: AGENT_CONFIG_LIMITS.maxSteps }),
    maxOutputTokens:
      config.generation?.maxOutputTokens ??
      readNumber(env, 'POSTIZ_AI_MAX_OUTPUT_TOKENS', {
        min: 1,
        max: AGENT_CONFIG_LIMITS.maxOutputTokens,
      }),
    temperature:
      config.generation?.temperature ??
      readNumber(env, 'POSTIZ_AI_TEMPERATURE', { min: 0, max: 2 }),
  };
  const cleanGeneration = Object.fromEntries(
    Object.entries(generation).filter(([, value]) => value !== undefined)
  );

  const mcpServers: Record<string, SystemMcpServer> = Object.fromEntries(
    Object.entries(config.mcpServers ?? {}).map(([id, server]) => [
      id,
      {
        url: server.url,
        description: server.description,
        timeoutMs: server.timeoutMs,
        auth: server.auth,
        bearerTokenEnv: server.bearerTokenEnv,
        enabledTools: server.enabledTools,
      },
    ])
  );

  const langfuseBaseUrl = trimTrailingSlash(
    config.langfuse?.baseUrl ?? env.LANGFUSE_BASE_URL?.trim() ?? ''
  );
  const langfusePublicKeyEnv =
    config.langfuse?.publicKeyEnv ?? (langfuseBaseUrl ? 'LANGFUSE_PUBLIC_KEY' : undefined);
  const langfuseSecretKeyEnv =
    config.langfuse?.secretKeyEnv ?? (langfuseBaseUrl ? 'LANGFUSE_SECRET_KEY' : undefined);
  const providerCredentialConfigured = Boolean(env[providerApiKeyEnv]?.trim());
  const langfuseCredentialConfigured =
    Boolean(langfuseBaseUrl) &&
    Boolean(langfusePublicKeyEnv && env[langfusePublicKeyEnv]?.trim()) &&
    Boolean(langfuseSecretKeyEnv && env[langfuseSecretKeyEnv]?.trim());
  const langfuseConfigured = langfuseCredentialConfigured;

  const builtinTools = config.builtinTools ?? catalog;
  const allowedBuiltinTools = config.allowedBuiltinTools ?? catalog;
  const langfuseEnabled =
    (config.langfuse?.enabled ?? true) && langfuseCredentialConfigured;

  const sources: Record<string, ConfigSource> = {
    prompt: prompt.source,
    model: config.model ? 'file' : env.POSTIZ_AI_MODEL ? 'env' : 'builtin',
    titleModel:
      config.titleModel || config.model
        ? 'file'
        : env.POSTIZ_AI_TITLE_MODEL || env.POSTIZ_AI_MODEL
          ? 'env'
          : 'builtin',
    providerBaseUrl: config.provider ? 'file' : env.OPENAI_BASE_URL ? 'env' : 'builtin',
    builtinTools: config.builtinTools ? 'file' : 'builtin',
    generation: config.generation ? 'file' : 'env',
    langfuse: config.langfuse ? 'file' : langfuseBaseUrl ? 'env' : 'builtin',
    skills: skillsSource,
    mcpServers: config.mcpServers ? 'file' : 'builtin',
  };

  return {
    prompt: prompt.prompt,
    model,
    titleModel,
    providerBaseUrl,
    providerApiKeyEnv,
    providerCredentialConfigured,
    builtinTools,
    allowedBuiltinTools,
    skills,
    mcpServers,
    generation: cleanGeneration,
    langfuse: {
      enabled: langfuseEnabled,
      baseUrl: langfuseBaseUrl || undefined,
      publicKeyEnv: langfusePublicKeyEnv,
      secretKeyEnv: langfuseSecretKeyEnv,
      allowedBaseUrls: config.langfuse?.allowedBaseUrls ?? (langfuseBaseUrl ? [langfuseBaseUrl] : []),
      captureContent: config.langfuse?.captureContent ?? false,
      langfuseCredentialConfigured,
    },
    sources,
    defaultsVersion: versionHash({
      prompt: prompt.prompt,
      model,
      titleModel,
      providerBaseUrl,
      providerApiKeyEnv,
      builtinTools,
      allowedBuiltinTools,
      skills,
      mcpServers,
      generation: cleanGeneration,
      langfuse: {
        enabled: langfuseEnabled,
        baseUrl: langfuseBaseUrl,
        allowedBaseUrls: config.langfuse?.allowedBaseUrls,
        captureContent: config.langfuse?.captureContent,
      },
    }),
  };
}
