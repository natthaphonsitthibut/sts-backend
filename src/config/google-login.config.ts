import { registerAs } from '@nestjs/config';

export type GoogleLoginMode = 'oidc' | 'development';

export interface GoogleLoginRuntimeConfig {
  mode: GoogleLoginMode;
  nodeEnv: string;
  clientId: string;
  clientSecret: string;
  classroomCallbackUrl: string;
  teacherLineCallbackUrl: string;
  taskCallbackUrl: string;
}

function googleLoginMode(value: string | undefined): GoogleLoginMode {
  const normalized = value?.trim().toLowerCase() || 'oidc';
  if (normalized !== 'oidc' && normalized !== 'development') {
    throw new Error('GOOGLE_LOGIN_MODE must be oidc or development');
  }
  return normalized;
}

export const googleLoginConfig = registerAs(
  'googleLogin',
  (): GoogleLoginRuntimeConfig => ({
    mode: googleLoginMode(process.env.GOOGLE_LOGIN_MODE),
    nodeEnv: process.env.NODE_ENV?.trim().toLowerCase() || 'development',
    clientId: process.env.GOOGLE_LOGIN_CLIENT_ID?.trim() || '',
    clientSecret: process.env.GOOGLE_LOGIN_CLIENT_SECRET?.trim() || '',
    classroomCallbackUrl:
      process.env.GOOGLE_LOGIN_CLASSROOM_CALLBACK_URL?.trim() ||
      process.env.GOOGLE_LOGIN_CALLBACK_URL?.trim() ||
      '',
    teacherLineCallbackUrl: process.env.GOOGLE_LOGIN_TEACHER_LINE_CALLBACK_URL?.trim() || '',
    taskCallbackUrl: process.env.GOOGLE_LOGIN_TASK_CALLBACK_URL?.trim() || '',
  }),
);
