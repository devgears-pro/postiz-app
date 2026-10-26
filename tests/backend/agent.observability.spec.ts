import { AgentObservabilityService } from '@gitroom/nestjs-libraries/chat/agent.observability';

describe('AgentObservabilityService', () => {
  it('creates a registry when Langfuse is disabled', () => {
    const service = new AgentObservabilityService();

    const registry = service.createRegistry({
      langfuse: { enabled: false },
    } as never);

    expect(registry).toBeDefined();
  });
});
