import { ForbiddenException } from '@nestjs/common';
import { AdminController } from '@gitroom/backend/api/routes/admin.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { AdminCreateOrganizationDto } from '@gitroom/nestjs-libraries/dtos/auth/admin.create.organization.dto';

const SUPER_ADMIN = { id: 'admin-1', isSuperAdmin: true } as any;
const ORG_OWNER = { id: 'owner-1', isSuperAdmin: false } as any;

const BODY: AdminCreateOrganizationDto = {
  company: 'Acme',
  email: 'owner@example.test',
  password: 'InitialPass123!',
};

describe('AdminController.createOrganization', () => {
  const authService = {
    createLocalOrganization: jest.fn(),
  };
  const controller = new AdminController(
    {} as any,
    {} as any,
    authService as unknown as AuthService
  );

  beforeEach(() => {
    authService.createLocalOrganization.mockReset();
  });

  it('rejects an organization owner with 403 and creates nothing', async () => {
    await expect(
      controller.createOrganization(ORG_OWNER, BODY, '127.0.0.1', 'jest')
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(authService.createLocalOrganization).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller with 401', async () => {
    await expect(
      controller.createOrganization(undefined as any, BODY, '127.0.0.1', 'jest')
    ).rejects.toMatchObject({ status: 401 });

    expect(authService.createLocalOrganization).not.toHaveBeenCalled();
  });

  it('creates an organization for a global administrator', async () => {
    authService.createLocalOrganization.mockResolvedValue({
      organizationId: 'org-1',
      ownerId: 'user-1',
      activationRequired: true,
    });

    await expect(
      controller.createOrganization(SUPER_ADMIN, BODY, '127.0.0.1', 'jest')
    ).resolves.toEqual({
      organizationId: 'org-1',
      ownerId: 'user-1',
      activationRequired: true,
    });

    expect(authService.createLocalOrganization).toHaveBeenCalledWith(
      BODY,
      '127.0.0.1',
      'jest'
    );
  });
});
