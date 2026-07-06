import { SetMetadata } from '@nestjs/common';

// Opt-out marker for the global AuthGuard (registered as APP_GUARD in
// app.module.ts). Auth is fail-closed by default now: a new controller with no
// guard is protected automatically, and only routes explicitly marked @Public
// (guest/magic-link/token flows, health checks, pre-login endpoints) skip it.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
