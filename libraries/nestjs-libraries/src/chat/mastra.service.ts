import { Mastra } from '@mastra/core/mastra';
import { ConsoleLogger } from '@mastra/core/logger';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { Injectable } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { AgentDefaultsService } from '@gitroom/nestjs-libraries/chat/agent.defaults.service';
import { AgentObservabilityService } from '@gitroom/nestjs-libraries/chat/agent.observability';

@Injectable()
export class MastraService {
  static mastra: Mastra;
  constructor(
    private _loadToolsService: LoadToolsService,
    private _defaults: AgentDefaultsService,
    private _observability: AgentObservabilityService
  ) {}
  async mastra() {
    if (MastraService.mastra) return MastraService.mastra;

    const defaults = await this._defaults.get();
    MastraService.mastra = new Mastra({
      storage: pStore,
      agents: {
        postiz: await this._loadToolsService.agent(),
      },
      observability: this._observability.createRegistry(defaults),
      logger: new ConsoleLogger({
        level: 'info',
      }),
    });

    return MastraService.mastra;
  }
}
