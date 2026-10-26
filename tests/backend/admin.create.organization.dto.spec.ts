import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminCreateOrganizationDto } from '@gitroom/nestjs-libraries/dtos/auth/admin.create.organization.dto';

const build = (values: Record<string, unknown>) =>
  plainToInstance(AdminCreateOrganizationDto, values);

describe('AdminCreateOrganizationDto', () => {
  it('accepts the initial password at the lower boundary', async () => {
    const errors = await validate(
      build({
        company: 'Acme',
        email: 'owner@example.test',
        password: '12345678',
      })
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects a password one character below the lower boundary', async () => {
    const errors = await validate(
      build({
        company: 'Acme',
        email: 'owner@example.test',
        password: '1234567',
      })
    );

    expect(errors.map((error) => error.property)).toEqual(['password']);
  });

  it('rejects a malformed email', async () => {
    const errors = await validate(
      build({
        company: 'Acme',
        email: 'owner',
        password: '12345678',
      })
    );

    expect(errors.map((error) => error.property)).toEqual(['email']);
  });

  it('rejects a company name shorter than three characters', async () => {
    const errors = await validate(
      build({
        company: 'Ab',
        email: 'owner@example.test',
        password: '12345678',
      })
    );

    expect(errors.map((error) => error.property)).toEqual(['company']);
  });
});
