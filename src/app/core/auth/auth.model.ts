export type AuthStatus =
  /** Local mode — nothing to authenticate; treated as always "ready". */
  | 'disabled'
  /** Cloud mode, resolving whether a session already exists. */
  | 'checking'
  | 'signed-out'
  | 'signed-in'
  | 'error';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
}
