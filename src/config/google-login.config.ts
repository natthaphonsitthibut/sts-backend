import { registerAs } from '@nestjs/config';

export interface GoogleLoginRuntimeConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export const googleLoginConfig = registerAs(
  'googleLogin',
  (): GoogleLoginRuntimeConfig => ({
    clientId: process.env.GOOGLE_LOGIN_CLIENT_ID?.trim() || '',
    clientSecret: process.env.GOOGLE_LOGIN_CLIENT_SECRET?.trim() || '',
    callbackUrl: process.env.GOOGLE_LOGIN_CALLBACK_URL?.trim() || '',
  }),
);
