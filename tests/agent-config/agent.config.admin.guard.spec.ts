import { ForbiddenException } from '@nestjs/common';
import { AgentConfigAdminGuard } from '@gitroom/backend/services/auth/agent.config.admin.guard';

const context = (request: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as any;

describe('AgentConfigAdminGuard', () => {
  const guard = new AgentConfigAdminGuard();

  it('allows an organization administrator', () => {
    const request = {
      user: { id: 'user-1' },
      org: { users: [{ userId: 'user-1', role: 'ADMIN' }] },
    };

    expect(guard.canActivate(context(request))).toBe(true);
  });

  it('allows a global administrator', () => {
    const request = {
      user: { id: 'user-1', isSuperAdmin: true },
      org: { users: [{ userId: 'user-1', role: 'USER' }] },
    };

    expect(guard.canActivate(context(request))).toBe(true);
  });

  it('rejects a regular member even without Stripe configuration', () => {
    const request = {
      user: { id: 'user-1' },
      org: { users: [{ userId: 'user-1', role: 'USER' }] },
    };

    expect(() => guard.canActivate(context(request))).toThrow(
      ForbiddenException
    );
  });

  it('rejects a request without an organization', () => {
    expect(() =>
      guard.canActivate(context({ user: { id: 'user-1' } }))
    ).toThrow(ForbiddenException);
  });

  it('does not treat another members role as the callers role', () => {
    const request = {
      user: { id: 'user-1' },
      org: {
        users: [
          { userId: 'user-2', role: 'ADMIN' },
          { userId: 'user-1', role: 'USER' },
        ],
      },
    };

    expect(() => guard.canActivate(context(request))).toThrow(
      ForbiddenException
    );
  });
});
