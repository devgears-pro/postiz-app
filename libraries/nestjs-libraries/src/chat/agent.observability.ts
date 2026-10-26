import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import {
  DefaultObservabilityInstance,
  Observability,
} from '@mastra/observability';
import { LangfuseExporter } from '@mastra/langfuse';
import type {
  AnySpan,
  ObservabilityInstance,
  SpanOutputProcessor,
} from '@mastra/core/observability';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import type { ResolvedAgentBundle } from '@gitroom/nestjs-libraries/chat/agent.config.service';

const SERVICE_NAME = 'postiz-agent';
const OLD_EXPORTER_TTL_MS = 5 * 60 * 1000;
const REQUEST_CONTEXT_KEYS = [
  'organizationId',
  'threadId',
  'revision',
  'defaultsVersion',
];

const hideContentProcessor: SpanOutputProcessor = {
  name: 'postiz-hide-agent-content',
  process: (span?: AnySpan) =>
    span ? { ...span, input: undefined, output: undefined } : span,
  shutdown: async () => undefined,
};

const noopExporter = {
  name: 'postiz-disabled',
  exportTracingEvent: async () => undefined,
};

@Injectable()
export class AgentObservabilityService implements OnApplicationShutdown {
  private _logger = new Logger(AgentObservabilityService.name);
  private _registry?: Observability;
  private _orgKeys = new Map<string, string>();
  private _timers = new Map<string, NodeJS.Timeout>();

  createRegistry(defaults: SystemAgentDefaults): Observability {
    if (this._registry) return this._registry;

    const configs: Record<string, Record<string, unknown>> = {
      disabled: {
        serviceName: SERVICE_NAME,
        exporters: [noopExporter],
        requestContextKeys: REQUEST_CONTEXT_KEYS,
      },
    };

    if (defaults.langfuse.enabled && defaults.langfuse.baseUrl) {
      const publicKey = defaults.langfuse.publicKeyEnv
        ? process.env[defaults.langfuse.publicKeyEnv]
        : undefined;
      const secretKey = defaults.langfuse.secretKeyEnv
        ? process.env[defaults.langfuse.secretKeyEnv]
        : undefined;

      if (publicKey && secretKey) {
        configs.system = {
          serviceName: SERVICE_NAME,
          exporters: [
            new LangfuseExporter({
              publicKey,
              secretKey,
              baseUrl: defaults.langfuse.baseUrl,
              release: defaults.defaultsVersion,
              environment: process.env.NODE_ENV,
            }),
          ],
          requestContextKeys: REQUEST_CONTEXT_KEYS,
          ...(defaults.langfuse.captureContent
            ? {}
            : { spanOutputProcessors: [hideContentProcessor] }),
        };
      }
    }

    this._registry = new Observability({
      configs: configs as never,
      configSelector: ({ requestContext }) => {
        const key = (requestContext as any)?.get('agentObservabilityKey') as
          | string
          | undefined;
        if (!key || !this._registry?.hasInstance(key)) return 'disabled';
        return key;
      },
      sensitiveDataFilter: true,
    });

    return this._registry;
  }

  prepare(bundle: ResolvedAgentBundle): string {
    const registry = this._registry;
    if (!registry) return 'disabled';

    const langfuse = bundle.config.langfuse;
    if (
      !langfuse.enabled ||
      !langfuse.baseUrl ||
      langfuse.credential === 'none'
    ) {
      return 'disabled';
    }

    if (langfuse.credential === 'system') {
      return registry.hasInstance('system') ? 'system' : 'disabled';
    }

    const organizationId = bundle.config.organizationId;
    const key = `org:${organizationId}:${bundle.config.revision}`;

    if (!registry.hasInstance(key)) {
      const keys = bundle.secrets.langfuse;
      if (!keys) return 'disabled';

      const instance = new DefaultObservabilityInstance({
        name: key,
        serviceName: SERVICE_NAME,
        exporters: [
          new LangfuseExporter({
            publicKey: keys.publicKey,
            secretKey: keys.secretKey,
            baseUrl: langfuse.baseUrl,
            release: bundle.config.defaultsVersion,
            environment: process.env.NODE_ENV,
          }),
        ],
        requestContextKeys: REQUEST_CONTEXT_KEYS,
        ...(langfuse.captureContent
          ? {}
          : { spanOutputProcessors: [hideContentProcessor] }),
      });

      registry.registerInstance(key, instance as ObservabilityInstance);
    }

    this.scheduleCleanup(organizationId, key);
    return key;
  }

  async shutdown(): Promise<void> {
    for (const timer of this._timers.values()) clearTimeout(timer);
    this._timers.clear();
    await this._registry?.shutdown().catch((error) => {
      this._logger.warn(`Could not shut down agent observability: ${error}`);
    });
  }

  onApplicationShutdown(): Promise<void> {
    return this.shutdown();
  }

  private scheduleCleanup(organizationId: string, currentKey: string): void {
    const previous = this._orgKeys.get(organizationId);
    if (previous === currentKey) return;
    this._orgKeys.set(organizationId, currentKey);

    if (!previous) return;

    const timer = setTimeout(() => {
      this._registry?.unregisterInstance(previous);
      this._timers.delete(previous);
    }, OLD_EXPORTER_TTL_MS);
    timer.unref?.();
    this._timers.set(previous, timer);
  }
}
