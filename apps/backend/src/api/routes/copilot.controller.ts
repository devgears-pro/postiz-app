import {
  Logger,
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CopilotRuntime,
  EmptyAdapter,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { AgentRuntimeService } from '@gitroom/nestjs-libraries/chat/agent.runtime';

export type ChannelsContext = {
  integrations: string;
  organization: string;
  ui: string;
};

// the copilot runtime writes its own CORS headers on the response, keep them aligned with main.ts
const copilotCors = () => ({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:6274',
    ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
  ],
  credentials: !process.env.NOT_SECURED,
});

@Controller('/copilot')
export class CopilotController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _mastraService: MastraService,
    private _agentRuntime: AgentRuntimeService
  ) {}
  @Post('/chat')
  chatAgent(@Req() req: Request, @Res() res: Response) {
    if (
      process.env.OPENAI_API_KEY === undefined ||
      process.env.OPENAI_API_KEY === ''
    ) {
      Logger.warn('OpenAI API key not set, chat functionality will not work');
      return;
    }

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/chat',
      cors: copilotCors(),
      runtime: new CopilotRuntime(),
      serviceAdapter: new OpenAIAdapter({
        model: 'gpt-4.1',
      }),
    });

    return copilotRuntimeHandler(req, res);
  }

  @Post('/agent')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async agent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization
  ) {
    const mastra = await this._mastraService.mastra();

    const prepared = await this._agentRuntime
      .prepare(organization.id, { ui: true })
      .catch((error) => {
        Logger.warn(
          `Could not prepare the agent for ${organization.id}: ${error}`
        );
        throw new ServiceUnavailableException(
          'The agent is not configured correctly for this organization'
        );
      });

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      prepared.release().catch(() => undefined);
    };
    res.on('finish', release);
    res.on('close', release);

    const requestContext = new RequestContext<ChannelsContext>();
    requestContext.set(
      'integrations',
      req?.body?.body?.forwardedProps?.integrations || []
    );

    requestContext.set('organization', JSON.stringify(organization));
    requestContext.set('ui', 'true');
    const threadId = req?.body?.threadId || req?.body?.body?.threadId;
    if (threadId) requestContext.set('threadId' as never, threadId as never);
    prepared.applyTo(requestContext);

    const agents = MastraAgent.getLocalAgents({
      resourceId: organization.id,
      mastra,
      requestContext: requestContext as any,
    });

    const runtime = new CopilotRuntime({
      agents,
    });

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/agent',
      cors: copilotCors(),
      runtime,
      serviceAdapter: new EmptyAdapter(),
    });

    return copilotRuntimeHandler(req, res);
  }

  @Get('/credits')
  calculateCredits(
    @GetOrgFromRequest() organization: Organization,
    @Query('type')
    type: 'ai_images' | 'ai_videos' | 'clipping_minutes'
  ) {
    return this._subscriptionService.checkCredits(
      organization,
      type || 'ai_images'
    );
  }

  @Get('/:thread/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getMessagesList(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') threadId: string
  ): Promise<any> {
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    try {
      return await memory.recall({
        resourceId: organization.id,
        threadId,
      });
    } catch (err) {
      Logger.warn(`Could not recall messages for thread ${threadId}: ${err}`);
      return { messages: [] };
    }
  }

  @Get('/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getList(@GetOrgFromRequest() organization: Organization) {
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    const list = await memory.listThreads({
      filter: { resourceId: organization.id },
      perPage: 100000,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });

    return {
      threads: list.threads.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    };
  }
}
