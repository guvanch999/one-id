import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtConfig } from '../../../config/jwt.config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { ErrorCode } from '../../../common/constants/error-codes';
import type { AuthenticatedUser } from '../../../common/types/request-context';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const config = configService.get<JwtConfig>('jwt')!;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.accessSecret,
      issuer: config.issuer,
      audience: config.audience,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    // Only access tokens may authenticate API requests.
    if (payload.type !== 'access') {
      throw new UnauthorizedException({
        error: ErrorCode.UNAUTHORIZED,
        message: 'Invalid token type',
        details: {},
      });
    }
    return { id: payload.sub, email: payload.email };
  }
}
