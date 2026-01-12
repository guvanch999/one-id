import { registerAs } from '@nestjs/config';

const parseTtlToSeconds = (value: string | undefined, fallback: number) => {
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

export default registerAs(
  'jwt',
  (): JwtConfig => ({
    accessTokenTtl: parseTtlToSeconds(process.env.JWT_ACCESS_TTL, 900),
    refreshTokenTtl: parseTtlToSeconds(process.env.JWT_REFRESH_TTL, 2592000),
    accessSecret: process.env.JWT_ACCESS_SECRET || 'change-me-access',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-refresh',
    issuer: process.env.JWT_ISSUER || 'one-id',
    audience: process.env.JWT_AUDIENCE || 'one-id-clients',
  }),
);
