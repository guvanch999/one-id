import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import {
  CreationAttributes,
  Transaction,
  UniqueConstraintError,
} from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
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
import { UserStatus } from '../../common/enums/user-status.enum';
import { AppLoggerService } from '../../logger/logger.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  /** Refresh token lifetime in seconds. */
  refreshExpiresIn: number;
  tokenType: 'Bearer';
}

type RefreshClaims = JwtPayload & { jti: string };

/** bcrypt cost factor used for password hashes. */
export const PASSWORD_HASH_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly jwtConfig: JwtConfig;
  private dummyPasswordHash?: Promise<string>;

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
    const { password, ...profile } = payload;

    const existing = await this.usersService.findByEmail(profile.email);
    if (existing) {
      throw this.userExists();
    }

    // Hash outside the transaction so a DB connection is not held for the
    // duration of the (deliberately slow) bcrypt computation.
    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    try {
      return await this.sequelize.transaction(async (transaction) => {
        const user = await this.usersService.create(
          { ...profile, passwordHash },
          transaction,
        );
        return this.issueTokens(user, transaction);
      });
    } catch (error) {
      // Two concurrent registrations can both pass the lookup above; the
      // unique index on users.email is the real guard.
      if (error instanceof UniqueConstraintError) {
        throw this.userExists();
      }
      throw error;
    }
  }

  async login(payload: LoginDto): Promise<AuthTokens> {
    const user = await this.usersService.findByEmail(payload.email);

    // Always run a bcrypt comparison so that response time does not reveal
    // whether the e-mail address is registered.
    const passwordHash = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await bcrypt.compare(payload.password, passwordHash);

    if (!user || !valid) {
      throw new UnauthorizedException({
        error: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid credentials',
        details: {},
      });
    }

    this.assertUserIsActive(user);

    return this.sequelize.transaction((transaction) =>
      this.issueTokens(user, transaction),
    );
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a new
   * access/refresh pair is issued, atomically.
   *
   * The token row is locked with `SELECT ... FOR UPDATE`, so two concurrent
   * requests with the same token cannot both succeed. Presenting a token that
   * has already been revoked (e.g. rotated before) is treated as token theft:
   * every active refresh token of the user is revoked.
   */
  async refresh(payload: RefreshTokenDto): Promise<AuthTokens> {
    const claims = await this.verifyRefreshToken(payload.refreshToken);

    const tokens = await this.sequelize.transaction(async (transaction) => {
      const tokenRecord = await this.refreshTokenModel.findOne({
        where: { jti: claims.jti, userId: claims.sub },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (
        !tokenRecord ||
        !this.tokenMatchesHash(payload.refreshToken, tokenRecord.tokenHash)
      ) {
        throw this.tokenRevoked();
      }

      if (tokenRecord.revoked) {
        await this.revokeAllForUser(claims.sub, transaction);
        // Returning (instead of throwing) lets the revocation commit.
        return null;
      }

      if (tokenRecord.expiresAt.getTime() <= Date.now()) {
        throw this.tokenRevoked();
      }

      await tokenRecord.update({ revoked: true }, { transaction });

      const user = await this.usersService.findById(claims.sub, transaction);
      if (!user) {
        throw new UnauthorizedException({
          error: ErrorCode.UNAUTHORIZED,
          message: 'User not found',
          details: {},
        });
      }
      this.assertUserIsActive(user);

      return this.issueTokens(user, transaction);
    });

    if (!tokens) {
      this.logger.warn(
        `Refresh token reuse detected for user ${claims.sub}; all sessions revoked`,
        AuthService.name,
      );
      throw new UnauthorizedException({
        error: ErrorCode.TOKEN_REUSED,
        message: 'Refresh token reuse detected; all sessions have been revoked',
        details: {},
      });
    }

    return tokens;
  }

  /**
   * Revokes a single session (when a refresh token is given) or every
   * active session of the user.
   */
  async logout(userId: string, payload: LogoutDto): Promise<void> {
    if (!payload.refreshToken) {
      await this.revokeAllForUser(userId);
      return;
    }

    const refreshToken = payload.refreshToken;
    const claims = await this.verifyRefreshToken(refreshToken);
    if (claims.sub !== userId) {
      throw new UnauthorizedException({
        error: ErrorCode.UNAUTHORIZED,
        message: 'Invalid token owner',
        details: {},
      });
    }

    await this.sequelize.transaction(async (transaction) => {
      const tokenRecord = await this.refreshTokenModel.findOne({
        where: { jti: claims.jti, userId, revoked: false },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (
        !tokenRecord ||
        !this.tokenMatchesHash(refreshToken, tokenRecord.tokenHash)
      ) {
        throw this.tokenRevoked();
      }

      await tokenRecord.update({ revoked: true }, { transaction });
    });
  }

  private async verifyRefreshToken(token: string): Promise<RefreshClaims> {
    let claims: JwtPayload;
    try {
      claims = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.jwtConfig.refreshSecret,
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      });
    } catch (error) {
      this.logger.warn(
        `Refresh token verification failed: ${(error as Error).message}`,
        AuthService.name,
      );
      throw new UnauthorizedException({
        error: ErrorCode.TOKEN_EXPIRED,
        message: 'Refresh token invalid or expired',
        details: {},
      });
    }

    if (claims.type !== 'refresh' || !claims.jti || !claims.sub) {
      throw new UnauthorizedException({
        error: ErrorCode.UNAUTHORIZED,
        message: 'Invalid token type',
        details: {},
      });
    }

    return claims as RefreshClaims;
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

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.jwtConfig.accessSecret,
      expiresIn: this.jwtConfig.accessTokenTtl,
      issuer: this.jwtConfig.issuer,
      audience: this.jwtConfig.audience,
    });

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
    const jti = randomUUID();
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

    const decoded = this.jwtService.decode<{ exp?: number } | null>(
      refreshToken,
    );
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + this.jwtConfig.refreshTokenTtl * 1000);

    const refreshRecord: CreationAttributes<RefreshToken> = {
      userId: user.id,
      tokenHash: this.hashToken(refreshToken),
      jti,
      expiresAt,
      revoked: false,
    };

    await this.refreshTokenModel.create(refreshRecord, { transaction });

    return refreshToken;
  }

  private async revokeAllForUser(
    userId: string,
    transaction?: Transaction,
  ): Promise<void> {
    await this.refreshTokenModel.update(
      { revoked: true },
      { where: { userId, revoked: false }, transaction },
    );
  }

  /**
   * Refresh tokens are long, high-entropy strings, so a fast SHA-256 digest is
   * appropriate. (bcrypt only looks at the first 72 bytes of its input, which
   * for a JWT is the header plus the start of the payload.)
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private tokenMatchesHash(token: string, storedHash: string): boolean {
    const expected = Buffer.from(this.hashToken(token), 'hex');
    const actual = Buffer.from(storedHash, 'hex');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private assertUserIsActive(user: User): void {
    const status: UserStatus = user.status;
    if (status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        error: ErrorCode.ACCOUNT_BLOCKED,
        message: 'User account is blocked',
        details: {},
      });
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyPasswordHash ??= bcrypt.hash(randomUUID(), PASSWORD_HASH_ROUNDS);
    return this.dummyPasswordHash;
  }

  private userExists(): ConflictException {
    return new ConflictException({
      error: ErrorCode.CONFLICT,
      message: 'User already exists',
      details: {},
    });
  }

  private tokenRevoked(): UnauthorizedException {
    return new UnauthorizedException({
      error: ErrorCode.TOKEN_REVOKED,
      message: 'Refresh token revoked or expired',
      details: {},
    });
  }
}
