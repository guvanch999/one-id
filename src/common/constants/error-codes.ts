export enum ErrorCode {
  UNKNOWN_ERROR = 'unknown_error',
  VALIDATION_ERROR = 'validation_error',
  UNAUTHORIZED = 'unauthorized',
  FORBIDDEN = 'forbidden',
  NOT_FOUND = 'not_found',
  CONFLICT = 'conflict',
  TOKEN_EXPIRED = 'token_expired',
  TOKEN_REVOKED = 'token_revoked',
  TOKEN_REUSED = 'token_reused',
  INVALID_CREDENTIALS = 'invalid_credentials',
  ACCOUNT_BLOCKED = 'account_blocked',
}
