import { ConflictException } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';

const buildService = (options: {
  existingUser?: unknown;
  activated?: boolean;
}) => {
  const users = {
    getUserByEmail: jest.fn().mockResolvedValue(options.existingUser ?? null),
  };
  const organizations = {
    createOrgAndUser: jest.fn().mockResolvedValue({
      id: 'org-1',
      users: [
        {
          user: {
            id: 'user-1',
            email: 'owner@example.test',
            password: 'hash',
            activated: options.activated ?? false,
          },
        },
      ],
    }),
  };
  const email = { sendEmailSync: jest.fn().mockResolvedValue(undefined) };
  const providers = { getProvider: jest.fn() };

  const service = new AuthService(
    users as any,
    organizations as any,
    email as any,
    providers as any
  );

  return { service, users, organizations, email, providers };
};

const BODY = {
  company: '  Acme  ',
  email: 'Owner@Example.Test',
  password: 'InitialPass123!',
};

describe('AuthService.createLocalOrganization', () => {
  it('rejects an email that already has a local account', async () => {
    const { service, organizations } = buildService({
      existingUser: { id: 'user-0' },
    });

    await expect(
      service.createLocalOrganization(BODY, '127.0.0.1', 'jest')
    ).rejects.toBeInstanceOf(ConflictException);

    expect(organizations.createOrgAndUser).not.toHaveBeenCalled();
  });

  it('creates the organization with a normalised owner email', async () => {
    const { service, organizations } = buildService({});

    await service.createLocalOrganization(BODY, '127.0.0.1', 'jest');

    expect(organizations.createOrgAndUser).toHaveBeenCalledWith(
      expect.objectContaining({
        company: 'Acme',
        email: 'owner@example.test',
        provider: Provider.LOCAL,
      }),
      '127.0.0.1',
      'jest'
    );
  });

  it('requires activation and sends the activation email when mail is configured', async () => {
    const { service, email } = buildService({ activated: false });

    const result = await service.createLocalOrganization(
      BODY,
      '127.0.0.1',
      'jest'
    );

    expect(result).toEqual({
      organizationId: 'org-1',
      ownerId: 'user-1',
      activationRequired: true,
    });
    expect(email.sendEmailSync).toHaveBeenCalledWith(
      'owner@example.test',
      'Activate your account',
      expect.stringContaining('/auth/activate/')
    );
  });

  it('skips the activation email for an already active owner', async () => {
    const { service, email } = buildService({ activated: true });

    const result = await service.createLocalOrganization(
      BODY,
      '127.0.0.1',
      'jest'
    );

    expect(result.activationRequired).toBe(false);
    expect(email.sendEmailSync).not.toHaveBeenCalled();
  });
});
