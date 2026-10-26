import { Injectable } from '@nestjs/common';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import { loadAgentDefaults } from '@gitroom/nestjs-libraries/chat/agent.defaults';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';

@Injectable()
export class AgentDefaultsService {
  private loaded?: Promise<SystemAgentDefaults>;

  constructor(private _loadTools: LoadToolsService) {}

  get(): Promise<SystemAgentDefaults> {
    return (this.loaded ??= loadAgentDefaults(process.env, {
      toolCatalog: this._loadTools.catalog(),
    }));
  }
}
