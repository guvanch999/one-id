import {
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ErrorCode } from '../../common/constants/error-codes';
import { UserStatus } from '../../common/enums/user-status.enum';
import { JwtConfig } from '../../config/jwt.config';
import { RefreshToken } from '../../database/models/refresh-token.model';
import { User } from '../../database/models/user.model';
import { AppLoggerService } from '../../logger/logger.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const jwtConfig: JwtConfig = {
  accessTokenTtl: 900,
  refreshTokenTtl: 2_592_000,
  accessSecret: 'test-access-secret',
  refreshSecret: 'test-refresh-secret',
  issuer: 'one-id',
  audience: 'one-id-clients',
};

const PASSWORD = 'CorrectHorse1!';
// Low cost factor keeps the fixtures fast; bcrypt.compare works for any cost.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: randomUUID(),
    email: 'alice@example.com',
    passwordHash: PASSWORD_HASH,
    firstName: null,
    lastName: null,
    status: UserStatus.ACTIVE,
    ...overrides,
  }) as User;

interface TokenRow {
  id: string;
  userId: string;
  jti: string;
  tokenHash: string;
  expiresAt: Date;
  revoked: boolean;
  update: jest.Mock;
}

type Where = Partial<Record<keyof TokenRow, unknown>>;

/**
 * Minimal in-memory stand-in for the RefreshToken Sequelize model, covering
 * the subset of the API that AuthService uses.
 */
class InMemoryRefreshTokens {
  rows: TokenRow[] = [];

  create = jest.fn((attrs: Omit<TokenRow, 'id' | 'update'>) => {
    const row = { id: randomUUID(), ...attrs } as TokenRow;
    row.update = jest.fn((values: Partial<TokenRow>) =>
      Promise.resolve(Object.assign(row, values)),
    );
    this.rows.push(row);
    return Promise.resolve(row);
  });

  findOne = jest.fn((options: { where: Where }) =>
    Promise.resolve(this.rows.find((row) => this.matches(row, options.where))),
  );

  update = jest.fn((values: Partial<TokenRow>, options: { where: Where }) => {
    const hits = this.rows.filter((row) => this.matches(row, options.where));
    hits.forEach((row) => Object.assign(row, values));
    return Promise.resolve([hits.length]);
  });

  snapshot() {
    const states = this.rows.map((row) => ({ row, revoked: row.revoked }));
    return () => {
      this.rows = states.map(({ row, revoked }) =>
        Object.assign(row, { revoked }),
      );
    };
  }

  byToken(token: string): TokenRow | undefined {
    return this.rows.find((row) => row.tokenHash === sha256(token));
  }

  activeFor(userId: string): TokenRow[] {
    return this.rows.filter((row) => row.userId === userId && !row.revoked);
  }

  private matches(row: TokenRow, where: Where): boolean {
    return Object.entries(where).every(
      ([key, value]) => row[key as keyof TokenRow] === value,
    );
  }
}

async function expectHttpError(
  promise: Promise<unknown>,
  type: new (...args: any[]) => HttpException,
  code: ErrorCode,
): Promise<void> {
  const error: unknown = await promise.then(
    () => {
      throw new Error('Expected promise to reject');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject({
    error: code,
  });
}

describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;
  let tokens: InMemoryRefreshTokens;
  let users: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'findById' | 'create'>
  >;
  let transaction: jest.Mock;
  let logger: { warn: jest.Mock; log: jest.Mock; error: jest.Mock };
  const tx = { LOCK: { UPDATE: 'UPDATE' } };

  beforeEach(async () => {
    tokens = new InMemoryRefreshTokens();
    users = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    // Behaves like a managed transaction: changes are rolled back on throw.
    transaction = jest.fn(async (work: (t: typeof tx) => Promise<unknown>) => {
      const rollback = tokens.snapshot();
      try {
        return await work(tx);
      } catch (error) {
        rollback();
        throw error;
      }
    });
    logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        { provide: ConfigService, useValue: { get: () => jwtConfig } },
        { provide: UsersService, useValue: users },
        { provide: getModelToken(RefreshToken), useValue: tokens },
        { provide: Sequelize, useValue: { transaction } },
        { provide: AppLoggerService, useValue: logger },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  /** Logs `user` in and returns the issued token pair. */
  const loginAs = async (user: User) => {
    users.findByEmail.mockResolvedValue(user);
    users.findById.mockResolvedValue(user);
    return service.login({ email: user.email, password: PASSWORD });
  };

  describe('register', () => {
    const payload = {
      email: 'alice@example.com',
      password: PASSWORD,
      firstName: 'Alice',
    };

    it('creates the user with a bcrypt hash and issues a token pair', async () => {
      users.create.mockImplementation((attrs) =>
        Promise.resolve(makeUser(attrs as Partial<User>)),
      );

      const result = await service.register(payload);

      const [attrs, passedTx] = users.create.mock.calls[0];
      expect(attrs).not.toHaveProperty('password');
      expect(attrs).toMatchObject({ email: payload.email, firstName: 'Alice' });
      expect(await bcrypt.compare(PASSWORD, attrs.passwordHash)).toBe(true);
      expect(passedTx).toBe(tx);

      expect(result).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        refreshExpiresIn: 2_592_000,
      });
      expect(tokens.rows).toHaveLength(1);
      expect(tokens.byToken(result.refreshToken)).toMatchObject({
        revoked: false,
      });
    });

    it('rejects an e-mail that is already registered', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      await expectHttpError(
        service.register(payload),
        ConflictException,
        ErrorCode.CONFLICT,
      );
      expect(users.create.mock.calls).toHaveLength(0);
      expect(tokens.rows).toHaveLength(0);
    });

    it('maps a unique-constraint race on insert to 409 Conflict', async () => {
      users.create.mockRejectedValue(new UniqueConstraintError({}));

      await expectHttpError(
        service.register(payload),
        ConflictException,
        ErrorCode.CONFLICT,
      );
    });
  });

  describe('login', () => {
    it('issues an access token and a stored, hashed refresh token', async () => {
      const user = makeUser();

      const result = await loginAs(user);

      const access = await jwt.verifyAsync<JwtPayload>(result.accessToken, {
        secret: jwtConfig.accessSecret,
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      });
      expect(access).toMatchObject({ sub: user.id, type: 'access' });

      const refresh = await jwt.verifyAsync<JwtPayload>(result.refreshToken, {
        secret: jwtConfig.refreshSecret,
      });
      expect(refresh).toMatchObject({ sub: user.id, type: 'refresh' });

      const row = tokens.rows[0];
      expect(row).toMatchObject({
        userId: user.id,
        jti: refresh.jti,
        revoked: false,
        tokenHash: sha256(result.refreshToken),
      });
      // The stored row expires together with the JWT (30 days).
      const expectedExpiry = Date.now() + jwtConfig.refreshTokenTtl * 1000;
      expect(Math.abs(row.expiresAt.getTime() - expectedExpiry)).toBeLessThan(
        5_000,
      );
    });

    it('rejects a wrong password', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      await expectHttpError(
        service.login({ email: 'alice@example.com', password: 'wrong-pass' }),
        UnauthorizedException,
        ErrorCode.INVALID_CREDENTIALS,
      );
      expect(tokens.rows).toHaveLength(0);
    });

    it('rejects an unknown e-mail with the same error as a wrong password', async () => {
      await expectHttpError(
        service.login({ email: 'nobody@example.com', password: PASSWORD }),
        UnauthorizedException,
        ErrorCode.INVALID_CREDENTIALS,
      );
    });

    it('rejects a blocked user', async () => {
      users.findByEmail.mockResolvedValue(
        makeUser({ status: UserStatus.BLOCKED }),
      );

      await expectHttpError(
        service.login({ email: 'alice@example.com', password: PASSWORD }),
        ForbiddenException,
        ErrorCode.ACCOUNT_BLOCKED,
      );
      expect(tokens.rows).toHaveLength(0);
    });
  });

  describe('refresh', () => {
    it('revokes the presented token and issues a new pair', async () => {
      const user = makeUser();
      const first = await loginAs(user);

      const second = await service.refresh({
        refreshToken: first.refreshToken,
      });

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(tokens.byToken(first.refreshToken)?.revoked).toBe(true);
      expect(tokens.byToken(second.refreshToken)?.revoked).toBe(false);
      expect(tokens.activeFor(user.id)).toHaveLength(1);

      // The row is read with SELECT ... FOR UPDATE inside the transaction.
      expect(tokens.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ transaction: tx, lock: 'UPDATE' }),
      );

      // The rotated token keeps working.
      await expect(
        service.refresh({ refreshToken: second.refreshToken }),
      ).resolves.toHaveProperty('accessToken');
    });

    it('treats reuse of a rotated token as theft and revokes every session', async () => {
      const user = makeUser();
      const otherSession = await loginAs(user);
      const stolen = await loginAs(user);
      const rotated = await service.refresh({
        refreshToken: stolen.refreshToken,
      });
      expect(tokens.activeFor(user.id)).toHaveLength(2);

      await expectHttpError(
        service.refresh({ refreshToken: stolen.refreshToken }),
        UnauthorizedException,
        ErrorCode.TOKEN_REUSED,
      );

      // The revocation must be committed, not rolled back with the error.
      expect(tokens.activeFor(user.id)).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('reuse detected'),
        AuthService.name,
      );
      await expect(
        service.refresh({ refreshToken: rotated.refreshToken }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.refresh({ refreshToken: otherSession.refreshToken }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token that is not a valid refresh JWT', async () => {
      const user = makeUser();
      const { accessToken } = await loginAs(user);

      // Signed with the access secret -> fails refresh verification.
      await expectHttpError(
        service.refresh({ refreshToken: accessToken }),
        UnauthorizedException,
        ErrorCode.TOKEN_EXPIRED,
      );

      const expired = await jwt.signAsync(
        { sub: user.id, email: user.email, jti: randomUUID(), type: 'refresh' },
        {
          secret: jwtConfig.refreshSecret,
          issuer: jwtConfig.issuer,
          audience: jwtConfig.audience,
          expiresIn: -10,
        },
      );
      await expectHttpError(
        service.refresh({ refreshToken: expired }),
        UnauthorizedException,
        ErrorCode.TOKEN_EXPIRED,
      );
      expect(transaction).toHaveBeenCalledTimes(1); // only the login
    });

    it('rejects a refresh-signed token that is not of type "refresh"', async () => {
      const user = makeUser();
      const forged = await jwt.signAsync(
        { sub: user.id, email: user.email, type: 'access' },
        {
          secret: jwtConfig.refreshSecret,
          issuer: jwtConfig.issuer,
          audience: jwtConfig.audience,
        },
      );

      await expectHttpError(
        service.refresh({ refreshToken: forged }),
        UnauthorizedException,
        ErrorCode.UNAUTHORIZED,
      );
    });

    it('rejects a token whose row does not exist', async () => {
      const user = makeUser();
      const { refreshToken } = await loginAs(user);
      tokens.rows = [];

      await expectHttpError(
        service.refresh({ refreshToken }),
        UnauthorizedException,
        ErrorCode.TOKEN_REVOKED,
      );
    });

    it('rejects a token whose hash does not match the stored row', async () => {
      const user = makeUser();
      const { refreshToken } = await loginAs(user);
      tokens.rows[0].tokenHash = sha256('something else');

      await expectHttpError(
        service.refresh({ refreshToken }),
        UnauthorizedException,
        ErrorCode.TOKEN_REVOKED,
      );
      expect(tokens.rows[0].revoked).toBe(false);
    });

    it('rejects a token whose row has expired', async () => {
      const user = makeUser();
      const { refreshToken } = await loginAs(user);
      tokens.rows[0].expiresAt = new Date(Date.now() - 1_000);

      await expectHttpError(
        service.refresh({ refreshToken }),
        UnauthorizedException,
        ErrorCode.TOKEN_REVOKED,
      );
    });

    it('rejects a blocked user and keeps the token unrevoked (rollback)', async () => {
      const user = makeUser();
      const { refreshToken } = await loginAs(user);
      users.findById.mockResolvedValue(
        makeUser({ id: user.id, status: UserStatus.BLOCKED }),
      );

      await expectHttpError(
        service.refresh({ refreshToken }),
        ForbiddenException,
        ErrorCode.ACCOUNT_BLOCKED,
      );
      expect(tokens.byToken(refreshToken)?.revoked).toBe(false);
      expect(tokens.rows).toHaveLength(1);
    });

    it('rejects a token of a user that no longer exists', async () => {
      const user = makeUser();
      const { refreshToken } = await loginAs(user);
      users.findById.mockResolvedValue(null);

      await expectHttpError(
        service.refresh({ refreshToken }),
        UnauthorizedException,
        ErrorCode.UNAUTHORIZED,
      );
    });
  });

  describe('logout', () => {
    it('revokes only the session of the given refresh token', async () => {
      const user = makeUser();
      const phone = await loginAs(user);
      const laptop = await loginAs(user);

      await service.logout(user.id, { refreshToken: phone.refreshToken });

      expect(tokens.byToken(phone.refreshToken)?.revoked).toBe(true);
      expect(tokens.byToken(laptop.refreshToken)?.revoked).toBe(false);
    });

    it('revokes every session when no refresh token is given', async () => {
      const user = makeUser();
      const other = makeUser({ email: 'bob@example.com' });
      await loginAs(user);
      await loginAs(user);
      await loginAs(other);

      await service.logout(user.id, {});

      expect(tokens.activeFor(user.id)).toHaveLength(0);
      expect(tokens.activeFor(other.id)).toHaveLength(1);
    });

    it("rejects another user's refresh token", async () => {
      const user = makeUser();
      const other = makeUser({ email: 'bob@example.com' });
      const { refreshToken } = await loginAs(other);

      await expectHttpError(
        service.logout(user.id, { refreshToken }),
        UnauthorizedException,
        ErrorCode.UNAUTHORIZED,
      );
      expect(tokens.byToken(refreshToken)?.revoked).toBe(false);
    });

    it('rejects an already revoked refresh token', async () => {
      const user = makeUser();
      const { refreshToken } = await loginAs(user);
      await service.logout(user.id, { refreshToken });

      await expectHttpError(
        service.logout(user.id, { refreshToken }),
        UnauthorizedException,
        ErrorCode.TOKEN_REVOKED,
      );
    });
  });
});
