import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';

@Injectable()
export class AgentConfigAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: User;
      org?: Organization & {
        users?: Array<{ userId: string; role: string }>;
      };
    }>();

    if (!request?.user || !request?.org) {
      throw new ForbiddenException('Organization membership is required');
    }

    if (request.user.isSuperAdmin) {
      return true;
    }

    const membership =
      request.org.users?.find((member) => member.userId === request.user!.id) ??
      request.org.users?.[0];

    if (membership?.role === 'ADMIN' || membership?.role === 'SUPERADMIN') {
      return true;
    }

    throw new ForbiddenException(
      'Only organization administrators can change agent settings'
    );
  }
}
