import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({
    isGeneral: true,
    genericOauth: false,
    googleClientId: '',
    appleClientId: '',
    neynarClientId: '',
    billingEnabled: false,
  }),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));
jest.mock('@gitroom/frontend/components/auth/providers/github.provider', () => ({
  GithubProvider: () => null,
}));
jest.mock('@gitroom/frontend/components/auth/providers/oauth.provider', () => ({
  OauthProvider: () => null,
}));
jest.mock('@gitroom/frontend/components/auth/providers/google.provider', () => ({
  GoogleProvider: () => null,
}));
jest.mock('@gitroom/frontend/components/auth/providers/apple.provider', () => ({
  AppleProvider: () => null,
}));
jest.mock('@gitroom/frontend/components/auth/providers/farcaster.provider', () => ({
  FarcasterProvider: () => null,
}));
jest.mock('@gitroom/frontend/components/auth/providers/wallet.provider', () => ({
  __esModule: true,
  default: () => null,
}));

import { Login } from '@gitroom/frontend/components/auth/login';

describe('Login', () => {
  it('hides the social block when no provider is configured', () => {
    const html = renderToStaticMarkup(<Login registrationEnabled={false} />);

    expect(html).not.toContain('Continue With');
  });

  it('hides the sign up link when registration is disabled', () => {
    const html = renderToStaticMarkup(<Login registrationEnabled={false} />);

    expect(html).not.toContain('Sign Up');
  });
});
