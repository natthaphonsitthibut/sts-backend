import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query parameters an external identity provider appends to its redirect back
 * to us, on top of the `code`/`state` pair the flow actually reads.
 *
 * The redirect URL belongs to the provider, not to us: Google adds `iss`,
 * `scope`, `authuser` and `prompt` to every successful sign-in, plus `hd` for a
 * Workspace account. None of them are inputs — services read `code` and `state`
 * only — but the global ValidationPipe runs with `forbidNonWhitelisted: true`,
 * so an undeclared property is a 400 that strands a teacher who already signed
 * in successfully.
 *
 * A route-level `@Query(new ValidationPipe({ whitelist: true }))` does NOT fix
 * that: Nest applies `globalPipes.concat(paramPipes)`, so the global pipe runs
 * first and has already thrown. Declaring the properties here is what lets
 * `whitelist` drop them instead of rejecting the request.
 */
export class ExternalOAuthCallbackDto {
  /** Granted scopes, echoed by Google. Authorization is decided server-side. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  scope?: string;

  /** Index of the Google account used when several are signed in. */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  authuser?: string;

  /** Which consent prompt Google showed ('none' | 'consent' | 'select_account'). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  prompt?: string;

  /** Issuer, present when the response is an OpenID Connect one. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  iss?: string;

  /** Hosted Workspace domain of the account that signed in. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  hd?: string;

  /** OpenID Connect session identifier. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  session_state?: string;

  /**
   * Set instead of `code` when the user declines consent or the provider
   * refuses. Every callback has to reach its own failure page on this, so the
   * value must validate rather than 400.
   */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;

  /** Human-readable detail that accompanies `error`. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  error_description?: string;

  /** Documentation link that accompanies `error`. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  error_uri?: string;

  /** Google-specific refinement of `error`, e.g. 'access_denied'. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  error_subtype?: string;
}
