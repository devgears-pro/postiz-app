export const dynamic = 'force-dynamic';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { Login } from '@gitroom/frontend/components/auth/login';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Login`,
  description: '',
};
export default async function Auth() {
  const canRegister = (await (await internalFetch('/auth/can-register')).json())
    .register;

  return <Login registrationEnabled={canRegister} />;
}
