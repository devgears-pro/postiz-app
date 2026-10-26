import { Injectable } from '@nestjs/common';
import { createSkill } from '@mastra/core/skills';
import type { RequestContext } from '@mastra/core/di';
import type {
  ResolvedAgentConfig,
  ResolvedSkill,
} from '@gitroom/helpers/agent/agent.config.schema';
import { getAuth } from '@gitroom/nestjs-libraries/chat/async.storage';
import {
  AgentConfigService,
  type ResolvedAgentBundle,
} from '@gitroom/nestjs-libraries/chat/agent.config.service';
import {
  AgentConnectionsService,
  type AgentModel,
} from '@gitroom/nestjs-libraries/chat/agent.connections';
import { AgentObservabilityService } from '@gitroom/nestjs-libraries/chat/agent.observability';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';

export const AGENT_CONTEXT_KEYS = {
  prepared: 'agentPrepared',
  config: 'agentConfig',
  tools: 'agentTools',
  skills: 'agentSkills',
  model: 'agentModel',
  titleModel: 'agentTitleModel',
  observability: 'agentObservabilityKey',
} as const;

export type AgentRuntimeOptions = {
  ui: boolean;
  external?: boolean;
};

export type AgentPrepared = {
  bundle: ResolvedAgentBundle;
  config: ResolvedAgentConfig;
  model: AgentModel;
  titleModel: AgentModel;
  tools: Record<string, unknown>;
  skills: unknown[];
  observabilityKey: string;
  release: () => Promise<void>;
  applyTo: (requestContext: RequestContext<any>) => void;
};

const toInlineSkill = (skill: ResolvedSkill) =>
  createSkill({
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    ...(skill.references ? { references: skill.references } : {}),
    'user-invocable': true,
  });

@Injectable()
export class AgentRuntimeService {
  constructor(
    private _configService: AgentConfigService,
    private _connections: AgentConnectionsService,
    private _loadTools: LoadToolsService,
    private _observability: AgentObservabilityService
  ) {}

  async prepare(
    organizationId: string,
    options: AgentRuntimeOptions
  ): Promise<AgentPrepared> {
    const bundle = await this._configService.resolve(organizationId);
    const model = this._connections.createModel(bundle);
    const titleModel = this._connections.createTitleModel(bundle);

    const allTools = await this._loadTools.loadTools();
    const enabled = new Set(bundle.config.builtinTools);
    const builtinTools = Object.fromEntries(
      Object.entries(allTools).filter(([name]) => enabled.has(name))
    );

    const mcp = options.external
      ? { tools: {} as Record<string, unknown>, release: async () => undefined }
      : await this._connections.acquireMcp(bundle);

    for (const name of Object.keys(mcp.tools)) {
      if (name in builtinTools) {
        await mcp.release();
        throw new Error(`MCP tool ${name} collides with a built-in tool`);
      }
    }

    const observabilityKey = options.external
      ? 'disabled'
      : this._observability.prepare(bundle);

    const skills = bundle.config.skills.map(toInlineSkill);
    const tools = { ...builtinTools, ...mcp.tools };

    return {
      bundle,
      config: bundle.config,
      model,
      titleModel,
      tools,
      skills,
      observabilityKey,
      release: async () => {
        await mcp.release();
      },
      applyTo: (requestContext) => {
        requestContext.set(AGENT_CONTEXT_KEYS.prepared, true);
        requestContext.set(AGENT_CONTEXT_KEYS.config, bundle.config);
        requestContext.set(AGENT_CONTEXT_KEYS.model, model);
        requestContext.set(AGENT_CONTEXT_KEYS.titleModel, titleModel);
        requestContext.set(AGENT_CONTEXT_KEYS.tools, tools);
        requestContext.set(AGENT_CONTEXT_KEYS.skills, skills);
        requestContext.set(AGENT_CONTEXT_KEYS.observability, observabilityKey);
        requestContext.set('organizationId', organizationId);
      },
    };
  }

  async ensurePrepared(requestContext: RequestContext<any>): Promise<AgentPrepared> {
    if (requestContext.get(AGENT_CONTEXT_KEYS.prepared)) {
      return {
        bundle: undefined as unknown as ResolvedAgentBundle,
        config: requestContext.get(AGENT_CONTEXT_KEYS.config),
        model: requestContext.get(AGENT_CONTEXT_KEYS.model),
        titleModel: requestContext.get(AGENT_CONTEXT_KEYS.titleModel),
        tools: requestContext.get(AGENT_CONTEXT_KEYS.tools) ?? {},
        skills: requestContext.get(AGENT_CONTEXT_KEYS.skills) ?? [],
        observabilityKey:
          requestContext.get(AGENT_CONTEXT_KEYS.observability) ?? 'disabled',
        release: async () => undefined,
        applyTo: () => undefined,
      };
    }

    const organization = getAuth<{ id: string }>();
    if (!organization?.id) {
      throw new Error(
        'The agent needs an authenticated organization before it can run'
      );
    }

    const prepared = await this.prepare(organization.id, {
      ui: requestContext.get('ui') === 'true',
      external: true,
    });
    prepared.applyTo(requestContext);
    return prepared;
  }
}
