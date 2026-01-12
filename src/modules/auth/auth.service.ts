import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { CreationAttributes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtConfig } from '../../config/jwt.config';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from '../../database/models/user.model';
import { RefreshToken } from '../../database/models/refresh-token.model';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppLoggerService } from '../../logger/logger.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  tokenType: 'Bearer';
}

@Injectable()
export class AuthService {
  private readonly jwtConfig: JwtConfig;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(RefreshToken)
    private readonly refreshTokenModel: typeof RefreshToken,
    private readonly sequelize: Sequelize,
    private readonly logger: AppLoggerService,
  ) {
    this.jwtConfig = this.configService.get<JwtConfig>('jwt')!;
  }

  async register(payload: RegisterDto): Promise<AuthTokens> {
    return this.sequelize.transaction(async (transaction) => {
      const existing = await this.usersService.findByEmail(payload.email);
      if (existing) {
        throw new ConflictException({
          error: ErrorCode.CONFLICT,
          message: 'User already exists',
          details: {},
        });
      }

      const passwordHash = await this.hashPassword(payload.password);
      const user = await this.usersService.create(
        { ...payload, passwordHash },
        transaction,
      );

      return this.issueTokens(user, transaction);
    });
  }

  async login(payload: LoginDto): Promise<AuthTokens> {
    return this.sequelize.transaction(async (transaction) => {
      const user = await this.usersService.findByEmail(payload.email);
      if (!user) {
        throw new UnauthorizedException({
          error: ErrorCode.INVALID_CREDENTIALS,
          message: 'Invalid credentials',
          details: {},
        });
      }

      const valid = await bcrypt.compare(payload.password, user.passwordHash);
      if (!valid) {
        throw new UnauthorizedException({
          error: ErrorCode.INVALID_CREDENTIALS,
          message: 'Invalid credentials',
          details: {},
        });
      }

      return this.issueTokens(user, transaction);
    });
  }

  async refresh(payload: RefreshTokenDto): Promise<AuthTokens> {
    let decoded: JwtPayload & { exp?: number };

    try {
      decoded = await this.jwtService.verifyAsync(payload.refreshToken, {
        secret: this.jwtConfig.refreshSecret,
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      });
    } catch (error) {
      this.logger.warn(`Refresh token verification failed: ${error}`);
      throw new UnauthorizedException({
        error: ErrorCode.TOKEN_EXPIRED,
        message: 'Refresh token invalid or expired',
        details: {},
      });
    }

    if (decoded.type && decoded.type !== 'refresh') {
      throw new UnauthorizedException({
        error: ErrorCode.UNAUTHORIZED,
        message: 'Invalid token type',
        details: {},
      });
    }

    return this.sequelize.transaction(async (transaction) => {
      const tokenRecord = await this.refreshTokenModel.findOne({
        where: { jti: decoded.jti, userId: decoded.sub },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (
        !tokenRecord ||
        tokenRecord.revoked ||
        tokenRecord.expiresAt.getTime() < Date.now()
      ) {
        throw new UnauthorizedException({
          error: ErrorCode.TOKEN_REVOKED,
          message: 'Refresh token revoked or expired',
          details: {},
        });
      }

      const matches = await bcrypt.compare(
        payload.refreshToken,
        tokenRecord.tokenHash,
      );
      if (!matches) {
        throw new UnauthorizedException({
          error: ErrorCode.TOKEN_REVOKED,
          message: 'Refresh token revoked or expired',
          details: {},
        });
      }

      await tokenRecord.update({ revoked: true }, { transaction });

      const user = await this.usersService.findById(decoded.sub);
      if (!user) {
        throw new UnauthorizedException({
          error: ErrorCode.UNAUTHORIZED,
          message: 'User not found',
          details: {},
        });
      }

      return this.issueTokens(user, transaction);
    });
  }

  async logout(userId: string, payload: LogoutDto): Promise<void> {
    return this.sequelize.transaction(async (transaction) => {
      if (payload.refreshToken) {
        let decoded: JwtPayload & { jti?: string };
        try {
          decoded = await this.jwtService.verifyAsync(payload.refreshToken, {
            secret: this.jwtConfig.refreshSecret,
            issuer: this.jwtConfig.issuer,
            audience: this.jwtConfig.audience,
          });
        } catch {
          throw new UnauthorizedException({
            error: ErrorCode.TOKEN_REVOKED,
            message: 'Refresh token invalid or expired',
            details: {},
          });
        }

        if (decoded.sub !== userId || !decoded.jti) {
          throw new UnauthorizedException({
            error: ErrorCode.UNAUTHORIZED,
            message: 'Invalid token owner',
            details: {},
          });
        }

        const tokenRecord = await this.refreshTokenModel.findOne({
          where: { jti: decoded.jti, userId },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });

        if (!tokenRecord) {
          throw new UnauthorizedException({
            error: ErrorCode.TOKEN_REVOKED,
            message: 'Refresh token revoked or expired',
            details: {},
          });
        }

        const matches = await bcrypt.compare(
          payload.refreshToken,
          tokenRecord.tokenHash,
        );
        if (!matches) {
          throw new UnauthorizedException({
            error: ErrorCode.TOKEN_REVOKED,
            message: 'Refresh token revoked or expired',
            details: {},
          });
        }

        await tokenRecord.update({ revoked: true }, { transaction });
        return;
      }

      await this.refreshTokenModel.update(
        { revoked: true },
        { where: { userId }, transaction },
      );
    });
  }

  private async issueTokens(
    user: User,
    transaction?: Transaction,
  ): Promise<AuthTokens> {
    const accessPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'access',
    };

    const accessToken = await this.jwtService.signAsync(
      accessPayload,
      {
        secret: this.jwtConfig.accessSecret,
        expiresIn: this.jwtConfig.accessTokenTtl,
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      },
    );

    const refreshToken = await this.createRefreshToken(user, transaction);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwtConfig.accessTokenTtl,
      refreshExpiresIn: this.jwtConfig.refreshTokenTtl,
      tokenType: 'Bearer',
    };
  }

  private async createRefreshToken(
    user: User,
    transaction?: Transaction,
  ): Promise<string> {
    const jti = uuidv4();
    const refreshPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      jti,
      type: 'refresh',
    };

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.jwtConfig.refreshSecret,
      expiresIn: this.jwtConfig.refreshTokenTtl,
      issuer: this.jwtConfig.issuer,
      audience: this.jwtConfig.audience,
    });

    const tokenHash = await bcrypt.hash(refreshToken, 12);
    const decoded = this.jwtService.decode(refreshToken) as { exp?: number };
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(
          Date.now() + this.ttlToSeconds(this.jwtConfig.refreshTokenTtl) * 1000,
        );

    const refreshRecord: CreationAttributes<RefreshToken> = {
      userId: user.id,
      tokenHash,
      jti,
      expiresAt,
      revoked: false,
    };

    await this.refreshTokenModel.create(refreshRecord, { transaction });

    return refreshToken;
  }

  private async hashPassword(password: string) {
    return bcrypt.hash(password, 12);
  }

  private ttlToSeconds(ttl: string | number): number {
    if (typeof ttl === 'number') {
      return ttl;
    }

    const match = ttl.match(/^(\d+)([smhd])$/i);
    if (!match) {
      return Number(ttl) || 0;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return value * (multipliers[unit] ?? 1);
  }
}
