import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentDefaults } from '@gitroom/nestjs-libraries/chat/agent.defaults';

const CATALOG = [
  'integrationList',
  'integrationSchedulePostTool',
  'postsListTool',
];

const baseEnv = (extra: Record<string, string | undefined> = {}) => ({
  ...extra,
});

describe('loadAgentDefaults', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  const makeDir = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'postiz-agent-'));
    dirs.push(dir);
    return dir;
  };

  it('keeps built-in behavior when nothing is configured', async () => {
    const defaults = await loadAgentDefaults(baseEnv(), { toolCatalog: CATALOG });

    expect(defaults.prompt).toContain('schedule social media posts');
    expect(defaults.model).toBe('gpt-5.2');
    expect(defaults.titleModel).toBe('gpt-5.2');
    expect(defaults.providerBaseUrl).toBe('https://api.openai.com/v1');
    expect(defaults.providerApiKeyEnv).toBe('OPENAI_API_KEY');
    expect(defaults.builtinTools).toEqual(CATALOG);
    expect(defaults.allowedBuiltinTools).toEqual(CATALOG);
    expect(defaults.skills).toEqual({});
    expect(defaults.mcpServers).toEqual({});
    expect(defaults.langfuse.enabled).toBe(false);
    expect(defaults.generation).toEqual({});
    expect(defaults.defaultsVersion).toEqual(expect.any(String));
    expect(defaults.sources.prompt).toBe('builtin');
    expect(defaults.sources.model).toBe('builtin');
  });

  it('applies environment defaults for the provider and models', async () => {
    const defaults = await loadAgentDefaults(
      baseEnv({
        OPENAI_BASE_URL: 'https://litellm.example.test/v1/',
        POSTIZ_AI_MODEL: 'org-chat-model',
        POSTIZ_AI_TITLE_MODEL: 'org-title-model',
        POSTIZ_AI_MAX_STEPS: '12',
        POSTIZ_AI_TEMPERATURE: '0.2',
      }),
      { toolCatalog: CATALOG }
    );

    expect(defaults.providerBaseUrl).toBe('https://litellm.example.test/v1');
    expect(defaults.model).toBe('org-chat-model');
    expect(defaults.titleModel).toBe('org-title-model');
    expect(defaults.generation).toEqual({ maxSteps: 12, temperature: 0.2 });
    expect(defaults.sources.model).toBe('env');
  });

  it('enables Langfuse only with a host and both keys', async () => {
    const partial = await loadAgentDefaults(
      baseEnv({
        LANGFUSE_BASE_URL: 'https://langfuse.example.test',
        LANGFUSE_PUBLIC_KEY: 'pk',
      }),
      { toolCatalog: CATALOG }
    );
    const full = await loadAgentDefaults(
      baseEnv({
        LANGFUSE_BASE_URL: 'https://langfuse.example.test',
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
      }),
      { toolCatalog: CATALOG }
    );

    expect(partial.langfuse.enabled).toBe(false);
    expect(full.langfuse).toEqual(
      expect.objectContaining({
        enabled: true,
        baseUrl: 'https://langfuse.example.test',
        publicKeyEnv: 'LANGFUSE_PUBLIC_KEY',
        secretKeyEnv: 'LANGFUSE_SECRET_KEY',
        allowedBaseUrls: ['https://langfuse.example.test'],
      })
    );
    expect(full.langfuse.langfuseCredentialConfigured).toBe(true);
  });

  it('reads a shared prompt and skills from the deployment directory', async () => {
    const root = await makeDir();
    await writeFile(join(root, 'prompt.md'), 'Shared house rules');
    await mkdir(join(root, 'skills', 'marketing'), { recursive: true });
    await writeFile(
      join(root, 'skills', 'marketing', 'SKILL.md'),
      `---
name: marketing
description: Marketing guidance
---

Write for owners, not marketers.
`
    );
    await writeFile(
      join(root, 'agent.json'),
      JSON.stringify({
        schemaVersion: 1,
        promptFile: 'prompt.md',
        skills: ['skills/marketing'],
        model: 'file-model',
        provider: {
          baseUrl: 'https://litellm.example.test/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
      })
    );

    const defaults = await loadAgentDefaults(
      baseEnv({ POSTIZ_AI_CONFIG_DIR: root }),
      { toolCatalog: CATALOG }
    );

    expect(defaults.prompt).toBe('Shared house rules');
    expect(defaults.model).toBe('file-model');
    expect(defaults.skills.marketing).toEqual(
      expect.objectContaining({
        name: 'marketing',
        description: 'Marketing guidance',
        instructions: expect.stringContaining('Write for owners'),
      })
    );
    expect(defaults.sources.prompt).toBe('file');
    expect(defaults.sources.skills).toBe('file');
  });

  it('changes defaultsVersion when shared content changes', async () => {
    const root = await makeDir();
    await writeFile(join(root, 'prompt.md'), 'Version one');

    const first = await loadAgentDefaults(
      baseEnv({ POSTIZ_AI_CONFIG_DIR: root, POSTIZ_AI_PROMPT_FILE: 'prompt.md' }),
      { toolCatalog: CATALOG }
    );

    await writeFile(join(root, 'prompt.md'), 'Version two');
    const second = await loadAgentDefaults(
      baseEnv({ POSTIZ_AI_CONFIG_DIR: root, POSTIZ_AI_PROMPT_FILE: 'prompt.md' }),
      { toolCatalog: CATALOG }
    );

    expect(first.defaultsVersion).not.toBe(second.defaultsVersion);
  });

  it('rejects malformed explicit configuration', async () => {
    const root = await makeDir();
    await writeFile(join(root, 'agent.json'), '{ not json');

    await expect(
      loadAgentDefaults(baseEnv({ POSTIZ_AI_CONFIG_DIR: root }), {
        toolCatalog: CATALOG,
      })
    ).rejects.toThrow(/agent\.json/);
  });

  it('rejects a prompt file outside the shared root', async () => {
    const root = await makeDir();
    await writeFile(
      join(root, 'agent.json'),
      JSON.stringify({ promptFile: '../outside.md' })
    );

    await expect(
      loadAgentDefaults(baseEnv({ POSTIZ_AI_CONFIG_DIR: root }), {
        toolCatalog: CATALOG,
      })
    ).rejects.toThrow(/inside the shared root/);
  });

  it('rejects a symlink that escapes the shared root', async () => {
    const root = await makeDir();
    const outside = await makeDir();
    await writeFile(join(outside, 'secret.md'), 'outside');
    await symlink(join(outside, 'secret.md'), join(root, 'prompt.md'));
    await writeFile(
      join(root, 'agent.json'),
      JSON.stringify({ promptFile: 'prompt.md' })
    );

    await expect(
      loadAgentDefaults(baseEnv({ POSTIZ_AI_CONFIG_DIR: root }), {
        toolCatalog: CATALOG,
      })
    ).rejects.toThrow(/inside the shared root/);
  });

  it('rejects an environment value outside its documented range', async () => {
    await expect(
      loadAgentDefaults(baseEnv({ POSTIZ_AI_MAX_STEPS: '51' }), {
        toolCatalog: CATALOG,
      })
    ).rejects.toThrow(/POSTIZ_AI_MAX_STEPS/);
  });

  it('does not put secret values into the defaults', async () => {
    const defaults = await loadAgentDefaults(
      baseEnv({
        OPENAI_API_KEY: 'sk-super-secret',
        LANGFUSE_PUBLIC_KEY: 'pk-secret',
        LANGFUSE_SECRET_KEY: 'sk-secret',
        LANGFUSE_BASE_URL: 'https://langfuse.example.test',
      }),
      { toolCatalog: CATALOG }
    );

    const serialized = JSON.stringify(defaults);
    expect(serialized).not.toContain('sk-super-secret');
    expect(serialized).not.toContain('pk-secret');
    expect(serialized).not.toContain('sk-secret');
  });
});
