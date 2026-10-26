import { Global, Module } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { McpRelayService } from '@gitroom/nestjs-libraries/chat/mcp.relay.service';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import { AgentDefaultsService } from '@gitroom/nestjs-libraries/chat/agent.defaults.service';
import { AgentConnectionsService } from '@gitroom/nestjs-libraries/chat/agent.connections';
import { AgentObservabilityService } from '@gitroom/nestjs-libraries/chat/agent.observability';
import { AgentRuntimeService } from '@gitroom/nestjs-libraries/chat/agent.runtime';
import { AGENT_RUNTIME } from '@gitroom/nestjs-libraries/chat/agent.runtime.token';
import { AGENT_DEFAULTS } from '@gitroom/nestjs-libraries/chat/agent.defaults.token';

@Global()
@Module({
  providers: [
    MastraService,
    LoadToolsService,
    McpRelayService,
    AgentConfigService,
    AgentDefaultsService,
    AgentConnectionsService,
    AgentObservabilityService,
    AgentRuntimeService,
    { provide: AGENT_DEFAULTS, useExisting: AgentDefaultsService },
    { provide: AGENT_RUNTIME, useExisting: AgentRuntimeService },
    ...toolList,
  ],
  get exports() {
    return this.providers;
  },
})
export class ChatModule {}
