import { Test } from '@nestjs/testing';
import { AgentConnectionsService } from '@gitroom/nestjs-libraries/chat/agent.connections';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';

describe('AgentConnectionsService dependency injection', () => {
  it('resolves AgentConfigService from the constructor metadata', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentConnectionsService,
        { provide: AgentConfigService, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(AgentConnectionsService)).toBeInstanceOf(
      AgentConnectionsService
    );
  });
});
