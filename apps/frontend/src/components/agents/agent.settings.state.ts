import type {
  AgentConfigOverrides,
  AgentConfigView,
  McpServerDefinition,
  SecretChanges,
  SkillDefinition,
} from '@gitroom/helpers/agent/agent.config.schema';

export type FormSkill = SkillDefinition & {
  inherited: boolean;
  enabled: boolean;
};

export type FormMcpServer = McpServerDefinition & {
  id: string;
  inherited: boolean;
};

export const formSkills = (view: AgentConfigView): FormSkill[] => {
  const skills = new Map<string, FormSkill>();

  for (const skill of view.defaults.skills) {
    skills.set(skill.name, {
      ...skill,
      inherited: true,
      enabled: view.overrides.skills?.[skill.name] !== null,
    });
  }

  for (const [name, skill] of Object.entries(view.overrides.skills ?? {})) {
    if (!skill) continue;
    skills.set(name, { ...skill, inherited: false, enabled: true });
  }

  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const formMcpServers = (view: AgentConfigView): FormMcpServer[] => {
  const servers = new Map<string, FormMcpServer>();

  for (const server of view.defaults.mcpServers) {
    servers.set(server.id, {
      ...server,
      inherited: true,
    });
  }

  for (const [id, server] of Object.entries(view.overrides.mcpServers ?? {})) {
    if (!server) continue;
    servers.set(id, { ...server, id, inherited: false });
  }

  return [...servers.values()].sort((a, b) => a.id.localeCompare(b.id));
};

export const setPrompt = (
  overrides: AgentConfigOverrides,
  value: string
): AgentConfigOverrides => {
  const next = { ...overrides };
  if (!value.trim()) {
    delete next.systemPrompt;
  } else {
    next.systemPrompt = value;
  }
  return next;
};

export const setSkillEnabled = (
  view: AgentConfigView,
  overrides: AgentConfigOverrides,
  name: string,
  enabled: boolean
): AgentConfigOverrides => {
  const inherited = view.defaults.skills.some((skill) => skill.name === name);
  const skills = { ...(overrides.skills ?? {}) };

  if (enabled) {
    if (inherited) delete skills[name];
    else if (!skills[name]) {
      const local = formSkills(view).find((skill) => skill.name === name);
      if (local) skills[name] = local;
    }
  } else if (inherited) {
    skills[name] = null;
  } else {
    delete skills[name];
  }

  return { ...overrides, skills };
};

export const upsertSkill = (
  overrides: AgentConfigOverrides,
  skill: SkillDefinition
): AgentConfigOverrides => ({
  ...overrides,
  skills: { ...(overrides.skills ?? {}), [skill.name]: skill },
});

export const removeSkill = (
  view: AgentConfigView,
  overrides: AgentConfigOverrides,
  name: string
): AgentConfigOverrides => {
  const inherited = view.defaults.skills.some((skill) => skill.name === name);
  const skills = { ...(overrides.skills ?? {}) };
  if (inherited) skills[name] = null;
  else delete skills[name];
  return { ...overrides, skills };
};

export const upsertMcpServer = (
  overrides: AgentConfigOverrides,
  id: string,
  server: McpServerDefinition
): AgentConfigOverrides => ({
  ...overrides,
  mcpServers: { ...(overrides.mcpServers ?? {}), [id]: server },
});

export const removeMcpServer = (
  view: AgentConfigView,
  overrides: AgentConfigOverrides,
  id: string
): AgentConfigOverrides => {
  const inherited = view.defaults.mcpServers.some((server) => server.id === id);
  const servers = { ...(overrides.mcpServers ?? {}) };
  if (inherited) servers[id] = null;
  else delete servers[id];
  return { ...overrides, mcpServers: servers };
};

export const setProvider = (
  overrides: AgentConfigOverrides,
  baseUrl: string
): AgentConfigOverrides => {
  const next = { ...overrides };
  if (!baseUrl.trim()) delete next.provider;
  else next.provider = { baseUrl: baseUrl.trim() };
  return next;
};

export const pruneSecrets = (secrets: SecretChanges): SecretChanges => {
  const next: SecretChanges = {};
  if (secrets.providerApiKey) next.providerApiKey = secrets.providerApiKey;

  const tokens = Object.fromEntries(
    Object.entries(secrets.mcpBearerTokens ?? {}).filter(([, value]) => value)
  );
  if (Object.keys(tokens).length) next.mcpBearerTokens = tokens;

  if (secrets.langfuse?.publicKey && secrets.langfuse?.secretKey) {
    next.langfuse = {
      publicKey: secrets.langfuse.publicKey,
      secretKey: secrets.langfuse.secretKey,
    };
  }

  return next;
};

export const toWriteRequest = (
  view: AgentConfigView,
  overrides: AgentConfigOverrides,
  secrets: SecretChanges
) => {
  const pruned = pruneSecrets(secrets);
  return {
    expectedRevision: view.revision,
    overrides,
    ...(Object.keys(pruned).length ? { secrets: pruned } : {}),
  };
};

export const isDirty = (
  view: AgentConfigView,
  overrides: AgentConfigOverrides,
  secrets: SecretChanges
) =>
  JSON.stringify(overrides) !== JSON.stringify(view.overrides) ||
  Object.keys(pruneSecrets(secrets)).length > 0;
