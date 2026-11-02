import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { AppLoggerService } from '../src/logger/logger.service';
import { AuthTokens } from '../src/modules/auth/auth.service';

/**
 * End-to-end flow against a real, migrated PostgreSQL database.
 * Not part of `npm test`; run with `npm run test:e2e` (see README).
 */
describe('Auth flow (e2e)', () => {
  let app: INestApplication<App>;
  const email = `e2e-${randomUUID()}@example.com`;
  const password = 'StrongPassw0rd!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Mirror the global setup from main.ts.
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidUnknownValues: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter(new AppLoggerService()));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });

  it('registers, logs in, rotates and detects refresh token reuse', async () => {
    const server = app.getHttpServer();

    await request(server)
      .post('/api/auth/register')
      .send({ email, password })
      .expect(201);

    await request(server)
      .post('/api/auth/register')
      .send({ email: email.toUpperCase(), password })
      .expect(409);

    const login = await request(server)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const first = login.body as AuthTokens;

    const rotated = await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    const second = rotated.body as AuthTokens;
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // Replaying the rotated token revokes every session of the user.
    const reuse = await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    expect(reuse.body).toMatchObject({ error: 'token_reused' });

    await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);
  });

  it('logout requires an access token and revokes the session', async () => {
    const server = app.getHttpServer();

    await request(server).post('/api/auth/logout').send({}).expect(401);

    const login = await request(server)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const tokens = login.body as AuthTokens;

    await request(server)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ refreshToken: tokens.refreshToken })
      .expect(204);

    await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
  });
});
