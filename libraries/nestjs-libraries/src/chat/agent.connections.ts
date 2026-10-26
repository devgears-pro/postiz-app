import { Injectable, Logger } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import type {
  McpTestInput,
  ProviderTestInput,
  ResolvedMcpServer,
} from '@gitroom/helpers/agent/agent.config.schema';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import type { ResolvedAgentBundle } from '@gitroom/nestjs-libraries/chat/agent.config.service';

export type AgentModel = ReturnType<ReturnType<typeof createOpenAI>['chat']>;

export type AgentMcpLease = {
  tools: Record<string, unknown>;
  release: () => Promise<void>;
};

export type ProviderTestResult = {
  ok: boolean;
  model: string;
  reason?: string;
};

export type McpTestResult = {
  ok: boolean;
  tools: string[];
  errors: Record<string, string>;
};

const TIMEOUT_MS = 10_000;

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '');

// Keeps each server's explicitly enabled tools, in the namespaced form the
// MCP client returns (`<serverId>_<toolName>`).
export const filterMcpTools = (
  servers: ResolvedMcpServer[],
  tools: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const server of servers) {
    const allowed = new Set(server.enabledTools);
    const prefix = `${server.id}_`;
    for (const [name, tool] of Object.entries(tools)) {
      if (!name.startsWith(prefix)) continue;
      if (!allowed.has(name.slice(prefix.length))) continue;
      result[name] = tool;
    }
  }
  return result;
};

const guardedFetch = (): typeof fetch =>
  ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, {
      ...init,
      redirect: 'error',
      dispatcher: getSsrfSafeDispatcher(),
    } as RequestInit)) as typeof fetch;

@Injectable()
export class AgentConnectionsService {
  private _logger = new Logger(AgentConnectionsService.name);

  constructor(private _agentConfigService: AgentConfigService) {}

  createModel(bundle: ResolvedAgentBundle): AgentModel {
    return this.provider(bundle).chat(bundle.config.model);
  }

  createTitleModel(bundle: ResolvedAgentBundle): AgentModel {
    return this.provider(bundle).chat(bundle.config.titleModel);
  }

  async acquireMcp(bundle: ResolvedAgentBundle): Promise<AgentMcpLease> {
    if (!bundle.config.mcpServers.length) {
      return { tools: {}, release: async () => undefined };
    }

    const servers: Record<string, Record<string, unknown>> = {};
    for (const server of bundle.config.mcpServers) {
      const token = this.mcpToken(bundle, server);
      if (server.auth === 'bearer' && !token) {
        throw new Error(`MCP server ${server.id} requires a bearer token`);
      }

      servers[server.id] = {
        url: new URL(server.url),
        ...(token
          ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
          : {}),
        ...(this.isTrustedMcp(bundle, server) ? {} : { fetch: guardedFetch() }),
      };
    }

    const { MCPClient } = await import('@mastra/mcp');
    const client = new MCPClient({
      id: `postiz-${bundle.config.organizationId}-${bundle.config.revision}`,
      servers: servers as never,
      timeout: Math.min(
        ...bundle.config.mcpServers.map((server) => server.timeoutMs ?? TIMEOUT_MS)
      ),
    });

    try {
      const { tools, errors } = await client.listToolsWithErrors({
        perServerTimeoutMs: TIMEOUT_MS,
      });

      for (const [server, error] of Object.entries(errors ?? {})) {
        this._logger.warn(`MCP server ${server} failed: ${error}`);
      }

      return {
        tools: filterMcpTools(
          bundle.config.mcpServers,
          tools as Record<string, unknown>
        ),
        release: () => client.disconnect(),
      };
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      throw error;
    }
  }

  async testProvider(
    organizationId: string,
    input: ProviderTestInput
  ): Promise<ProviderTestResult> {
    const bundle = await this._agentConfigService.resolve(organizationId);
    const baseUrl = withoutTrailingSlash(
      input.provider?.baseUrl ?? bundle.config.provider.baseUrl
    );
    const model = input.model ?? bundle.config.model;
    const sameEndpoint = baseUrl === withoutTrailingSlash(bundle.config.provider.baseUrl);
    const apiKey =
      input.apiKey ??
      (sameEndpoint ? this.providerApiKey(bundle) : undefined);

    if (!apiKey) {
      return {
        ok: false,
        model,
        reason: 'Add an API key for this provider before testing it',
      };
    }

    const trusted = sameEndpoint && bundle.config.provider.credential === 'system';

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 5,
          stream: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
        ...(trusted ? {} : { dispatcher: getSsrfSafeDispatcher() }),
      } as RequestInit);

      if (!response.ok) {
        return {
          ok: false,
          model,
          reason: `The provider answered HTTP ${response.status}`,
        };
      }

      return { ok: true, model };
    } catch {
      return {
        ok: false,
        model,
        reason: 'The provider is unreachable from this instance',
      };
    }
  }

  async testMcp(
    organizationId: string,
    input: McpTestInput
  ): Promise<McpTestResult> {
    const bundle = await this._agentConfigService.resolve(organizationId);
    const existing = bundle.config.mcpServers.find(
      (server) => server.id === input.serverId
    );
    const sameUrl = existing?.url === input.server.url;
    const token =
      input.bearerToken ??
      (sameUrl && existing ? this.mcpToken(bundle, existing) : undefined);

    if (input.server.auth === 'bearer' && !token) {
      return {
        ok: false,
        tools: [],
        errors: { [input.serverId]: 'A bearer token is required' },
      };
    }

    const trusted = Boolean(
      sameUrl &&
        bundle.defaults.mcpServers[input.serverId]?.url === input.server.url
    );

    const { MCPClient } = await import('@mastra/mcp');
    const client = new MCPClient({
      id: `postiz-test-${organizationId}`,
      servers: {
        [input.serverId]: {
          url: new URL(input.server.url),
          ...(token
            ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
            : {}),
          ...(trusted ? {} : { fetch: guardedFetch() }),
        },
      } as never,
      timeout: TIMEOUT_MS,
    });

    try {
      const { tools, errors } = await client.listToolsWithErrors({
        perServerTimeoutMs: TIMEOUT_MS,
      });
      const prefix = `${input.serverId}_`;
      return {
        ok: Object.keys(errors ?? {}).length === 0,
        tools: Object.keys(tools ?? {})
          .filter((name) => name.startsWith(prefix))
          .map((name) => name.slice(prefix.length))
          .sort(),
        errors: errors ?? {},
      };
    } catch (error) {
      return {
        ok: false,
        tools: [],
        errors: {
          [input.serverId]:
            error instanceof Error ? error.message : 'MCP server is unreachable',
        },
      };
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }

  private provider(bundle: ResolvedAgentBundle) {
    return createOpenAI({
      baseURL: withoutTrailingSlash(bundle.config.provider.baseUrl),
      apiKey: this.providerApiKey(bundle),
      ...(this.isTrustedProvider(bundle)
        ? {}
        : { fetch: guardedFetch() }),
    });
  }

  private providerApiKey(bundle: ResolvedAgentBundle): string {
    if (bundle.config.provider.credential === 'organization') {
      if (!bundle.secrets.providerApiKey) {
        throw new Error('The organization provider API key is missing');
      }
      return bundle.secrets.providerApiKey;
    }

    const envName = bundle.defaults.providerApiKeyEnv ?? 'OPENAI_API_KEY';
    const key = process.env[envName];
    if (!key) {
      throw new Error(`Provider API key is not configured (${envName})`);
    }
    return key;
  }

  private isTrustedProvider(bundle: ResolvedAgentBundle): boolean {
    return (
      withoutTrailingSlash(bundle.config.provider.baseUrl) ===
      withoutTrailingSlash(bundle.defaults.providerBaseUrl)
    );
  }

  private isTrustedMcp(
    bundle: ResolvedAgentBundle,
    server: ResolvedMcpServer
  ): boolean {
    return bundle.defaults.mcpServers[server.id]?.url === server.url;
  }

  private mcpToken(
    bundle: ResolvedAgentBundle,
    server: ResolvedMcpServer
  ): string | undefined {
    if (server.credential === 'organization') {
      return bundle.secrets.mcpBearerTokens?.[server.id];
    }
    if (server.credential === 'system' && server.bearerTokenEnv) {
      return process.env[server.bearerTokenEnv];
    }
    return undefined;
  }
}
