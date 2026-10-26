import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({ admin: true, impersonate: null, tier: {} }),
}));
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ isSecured: true, billingEnabled: false }),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: jest.fn() }),
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));
jest.mock('@gitroom/frontend/components/layout/layout.context', () => ({
  setCookie: jest.fn(),
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn(),
}));
jest.mock('@gitroom/frontend/components/launches/import-debug-post.modal', () => ({
  ImportDebugPostModal: () => null,
}));
jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: undefined }),
  useSWRConfig: () => ({ mutate: jest.fn() }),
}));

import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';

describe('Admin bar', () => {
  it('offers organization creation without impersonating a user', () => {
    const html = renderToStaticMarkup(<Impersonate />);

    expect(html).toContain('Create Organization');
  });
});
