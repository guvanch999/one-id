import jwtConfig, { parseTtlToSeconds } from './jwt.config';

describe('parseTtlToSeconds', () => {
  it.each([
    ['900', 900],
    ['45s', 45],
    ['15m', 900],
    ['1h', 3600],
    ['30d', 2_592_000],
  ])('parses %s as %i seconds', (value, expected) => {
    expect(parseTtlToSeconds(value, 1)).toBe(expected);
  });

  it('falls back for missing or malformed values', () => {
    expect(parseTtlToSeconds(undefined, 60)).toBe(60);
    expect(parseTtlToSeconds('soon', 60)).toBe(60);
  });
});

describe('jwt config', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('requires secrets when NODE_ENV=production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: '',
      JWT_REFRESH_SECRET: '',
    };

    expect(() => jwtConfig()).toThrow('JWT_ACCESS_SECRET must be set');
  });

  it('uses development fallbacks outside production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: '',
      JWT_REFRESH_SECRET: '',
    };

    const config = jwtConfig();

    expect(config.accessSecret).toBeTruthy();
    expect(config.refreshSecret).toBeTruthy();
    expect(config.accessSecret).not.toBe(config.refreshSecret);
  });

  it('reads TTLs and claims from the environment', () => {
    process.env = {
      ...originalEnv,
      JWT_ACCESS_TTL: '5m',
      JWT_REFRESH_TTL: '7d',
      JWT_ISSUER: 'issuer-x',
      JWT_AUDIENCE: 'audience-y',
    };

    expect(jwtConfig()).toMatchObject({
      accessTokenTtl: 300,
      refreshTokenTtl: 604_800,
      issuer: 'issuer-x',
      audience: 'audience-y',
    });
  });
});
