import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('GET /health/ready reports database and redis connectivity', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok' },
    });
  });

  describe('auth + workspace flow', () => {
    const email = `e2e-${Date.now()}@example.com`;
    const password = 'password123';
    let accessToken: string;
    let workspaceId: string;

    it('registers a new user', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, fullName: 'E2E Test User' })
        .expect(201);

      expect(res.body.user.email).toBe(email);
      expect(res.body.accessToken).toBeDefined();
      accessToken = res.body.accessToken;
    });

    it('rejects registering the same email twice', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, fullName: 'Duplicate' })
        .expect(409);
    });

    it('logs in with the correct password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('rejects an incorrect password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);
    });

    it('returns the current user for GET /auth/me', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.email).toBe(email);
    });

    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('creates a workspace, making the creator OWNER', async () => {
      const res = await request(app.getHttpServer())
        .post('/workspaces')
        .set('authorization', `Bearer ${accessToken}`)
        .send({ name: 'E2E Workspace' })
        .expect(201);
      workspaceId = res.body.id;

      const members = await request(app.getHttpServer())
        .get('/workspace/members')
        .set('authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);
      expect(members.body).toHaveLength(1);
      expect(members.body[0].role).toBe('OWNER');
    });

    it('rejects tenant-scoped requests with no workspace header', async () => {
      await request(app.getHttpServer())
        .get('/conversations')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(403);
    });

    it('rejects access to a workspace the user does not belong to', async () => {
      const otherEmail = `e2e-other-${Date.now()}@example.com`;
      const otherUser = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: otherEmail, password, fullName: 'Other User' })
        .expect(201);

      await request(app.getHttpServer())
        .get('/conversations')
        .set('authorization', `Bearer ${otherUser.body.accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(403);
    });

    it('allows the workspace member to list their (empty) conversations', async () => {
      const res = await request(app.getHttpServer())
        .get('/conversations')
        .set('authorization', `Bearer ${accessToken}`)
        .set('x-workspace-id', workspaceId)
        .expect(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
    });
  });
});
