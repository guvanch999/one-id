import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtConfig } from '../../../config/jwt.config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const jwtConfig: JwtConfig = {
    accessTokenTtl: 900,
    refreshTokenTtl: 2_592_000,
    accessSecret: 'test-access-secret',
    refreshSecret: 'test-refresh-secret',
    issuer: 'one-id',
    audience: 'one-id-clients',
  };
  const configService = { get: () => jwtConfig } as unknown as ConfigService;
  const strategy = new JwtStrategy(configService);

  it('maps an access token payload to the request user', () => {
    const payload: JwtPayload = {
      sub: 'user-1',
      email: 'a@b.co',
      type: 'access',
    };

    expect(strategy.validate(payload)).toEqual({
      id: 'user-1',
      email: 'a@b.co',
    });
  });

  it('rejects tokens that are not access tokens', () => {
    const payload: JwtPayload = {
      sub: 'user-1',
      email: 'a@b.co',
      type: 'refresh',
      jti: 'jti-1',
    };

    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });
});
