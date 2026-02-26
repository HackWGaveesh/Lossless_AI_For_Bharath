import { Amplify } from 'aws-amplify';

export function configureAmplify() {
  const userPoolId = import.meta.env.VITE_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;

  if (!userPoolId || !userPoolClientId) {
    console.warn('Cognito env vars not set — auth will use dev bypass only');
    return;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: { phone: true },
        signUpVerificationMethod: 'code',
      },
    },
  });
}
