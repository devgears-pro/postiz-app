import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { AgentConfigAdminGuard } from '@gitroom/backend/services/auth/agent.config.admin.guard';
import {
  agentConfigWriteRequestSchema,
  mcpTestInputSchema,
  providerTestInputSchema,
  resetAgentConfigSchema,
  type AgentConfigWriteRequest,
  type McpTestInput,
  type ProviderTestInput,
} from '@gitroom/helpers/agent/agent.config.schema';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import { AgentConnectionsService } from '@gitroom/nestjs-libraries/chat/agent.connections';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization } from '@prisma/client';

@ApiTags('Agent Configuration')
@Controller('/agent-config')
@UseGuards(AgentConfigAdminGuard)
export class AgentConfigController {
  constructor(
    private _agentConfigService: AgentConfigService,
    private _connections: AgentConnectionsService
  ) {}

  @Get('/')
  get(@GetOrgFromRequest() organization: Organization) {
    return this._agentConfigService.getView(organization.id);
  }

  @Put('/')
  async save(
    @GetOrgFromRequest() organization: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: unknown
  ) {
    const parsed = agentConfigWriteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid agent configuration',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return this._agentConfigService.save(
      organization.id,
      user?.id ?? null,
      parsed.data as unknown as AgentConfigWriteRequest
    );
  }

  @Post('/reset')
  async reset(
    @GetOrgFromRequest() organization: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: unknown
  ) {
    const parsed = resetAgentConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid reset request',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return this._agentConfigService.reset(
      organization.id,
      user?.id ?? null,
      parsed.data.expectedRevision
    );
  }

  @Post('/test-provider')
  async testProvider(
    @GetOrgFromRequest() organization: Organization,
    @Body() body: unknown
  ) {
    const parsed = providerTestInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid provider test request',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    await this.assertRevision(organization.id, parsed.data.expectedRevision);
    return this._connections.testProvider(
      organization.id,
      parsed.data as unknown as ProviderTestInput
    );
  }

  @Post('/test-mcp')
  async testMcp(
    @GetOrgFromRequest() organization: Organization,
    @Body() body: unknown
  ) {
    const parsed = mcpTestInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid MCP test request',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    await this.assertRevision(organization.id, parsed.data.expectedRevision);
    return this._connections.testMcp(
      organization.id,
      parsed.data as unknown as McpTestInput
    );
  }

  private async assertRevision(
    organizationId: string,
    expectedRevision: number
  ): Promise<void> {
    const view = await this._agentConfigService.getView(organizationId);
    if (view.revision !== expectedRevision) {
      throw new ConflictException(
        'The agent configuration changed since it was loaded. Reload it and try again.'
      );
    }
  }
}
