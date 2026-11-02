import { registerAs } from '@nestjs/config';

/** Parses a TTL given as seconds ("900") or with a unit ("15m", "30d"). */
export const parseTtlToSeconds = (
  value: string | undefined,
  fallback: number,
) => {
  if (!value) {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  const match = value.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return fallback;
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };

  return amount * (multipliers[unit] ?? 1);
};

export interface JwtConfig {
  accessTokenTtl: number;
  refreshTokenTtl: number;
  accessSecret: string;
  refreshSecret: string;
  issuer: string;
  audience: string;
}

/**
 * Returns the secret from the environment. Outside production a well-known
 * development fallback is used; in production a missing secret is fatal.
 */
const readSecret = (name: string, devFallback: string): string => {
  const value = process.env[name];
  if (value) {
    return value;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set when NODE_ENV=production`);
  }
  return devFallback;
};

export default registerAs(
  'jwt',
  (): JwtConfig => ({
    accessTokenTtl: parseTtlToSeconds(process.env.JWT_ACCESS_TTL, 900),
    refreshTokenTtl: parseTtlToSeconds(process.env.JWT_REFRESH_TTL, 2592000),
    accessSecret: readSecret('JWT_ACCESS_SECRET', 'dev-access-secret'),
    refreshSecret: readSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    issuer: process.env.JWT_ISSUER || 'one-id',
    audience: process.env.JWT_AUDIENCE || 'one-id-clients',
  }),
);
