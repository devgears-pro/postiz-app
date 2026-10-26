import { FC, useCallback, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { AdminCreateOrganizationDto } from '@gitroom/nestjs-libraries/dtos/auth/admin.create.organization.dto';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';

const CreateOrganizationModal: FC<{ close: () => void }> = ({ close }) => {
  const fetch = useFetch();
  const toast = useToaster();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const resolver = useMemo(() => {
    return classValidatorResolver(AdminCreateOrganizationDto);
  }, []);
  const form = useForm({
    values: {
      company: '',
      email: '',
      password: '',
    },
    resolver,
    mode: 'onChange',
  });

  const submit = useCallback(async (values: AdminCreateOrganizationDto) => {
    setSaving(true);
    try {
      const response = await fetch('/admin/organizations', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const message = await response.text();
        toast.show(
          message ||
            t(
              'could_not_create_organization',
              'Could not create the organization'
            ),
          'warning'
        );
        return;
      }
      toast.show(t('organization_created', 'Organization created'));
      close();
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(submit)}>
        <div className="flex flex-col gap-[10px] min-w-[400px]">
          <Input
            label={t('label_company', 'Company')}
            placeholder={t('enter_company', 'Enter company')}
            name="company"
          />
          <Input
            label={t('label_email', 'Email')}
            placeholder={t('enter_email', 'Enter email')}
            name="email"
            type="email"
          />
          <Input
            label={t('label_password', 'Password')}
            placeholder={t('enter_initial_password', 'Enter initial password')}
            name="password"
            type="password"
          />
          <Button type="submit" loading={saving} className="rounded-[4px]">
            {t('create_organization', 'Create Organization')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
};

export const CreateOrganization = () => {
  const { openModal } = useModals();
  const t = useT();

  const handleClick = useCallback(() => {
    openModal({
      title: t('create_organization', 'Create Organization'),
      children: (close) => <CreateOrganizationModal close={close} />,
    });
  }, []);

  return (
    <div
      className="px-[10px] rounded-[4px] bg-pink-700 text-white cursor-pointer whitespace-nowrap"
      onClick={handleClick}
    >
      {t('create_organization', 'Create Organization')}
    </div>
  );
};
