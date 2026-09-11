import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { REDIS_CLIENT } from '../redis/redis.module';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let redis: { exists: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      setPasswordResetToken: jest.fn(),
      findByPasswordResetToken: jest.fn(),
      updatePassword: jest.fn(),
    };
    redis = { exists: jest.fn().mockResolvedValue(0), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              auth: {
                jwtSecret: 'test-access-secret',
                jwtAccessTtl: '15m',
                jwtRefreshSecret: 'test-refresh-secret',
                jwtRefreshTtl: '30d',
              },
            }),
          ],
        }),
        JwtModule.register({}),
      ],
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('rejects a duplicate email', async () => {
      usersService.findByEmail!.mockResolvedValue({ id: '1' } as any);
      await expect(
        service.register({
          email: 'a@b.com',
          password: 'password123',
          fullName: 'A',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the user and returns a token pair', async () => {
      usersService.findByEmail!.mockResolvedValue(null);
      usersService.create!.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        fullName: 'A',
      } as any);

      const result = await service.register({
        email: 'a@b.com',
        password: 'password123',
        fullName: 'A',
      });

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'a@b.com',
        fullName: 'A',
      });
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@b.com', fullName: 'A' }),
      );
    });
  });

  describe('login', () => {
    it('rejects an unknown email', async () => {
      usersService.findByEmail!.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nope@b.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an incorrect password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      usersService.findByEmail!.mockResolvedValue({
        id: '1',
        email: 'a@b.com',
        passwordHash,
      } as any);

      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a correct password and issues tokens', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      usersService.findByEmail!.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        fullName: 'A',
        passwordHash,
      } as any);

      const result = await service.login({
        email: 'a@b.com',
        password: 'correct-password',
      });
      expect(result.accessToken).toEqual(expect.any(String));
    });
  });

  describe('refresh', () => {
    it('rejects a refresh token that has already been blocklisted (reused)', async () => {
      usersService.findByEmail!.mockResolvedValue(null);
      usersService.create!.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        fullName: 'A',
      } as any);
      const { refreshToken } = await service.register({
        email: 'a@b.com',
        password: 'password123',
        fullName: 'A',
      });

      redis.exists.mockResolvedValue(1); // simulate: already used
      await expect(service.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates a valid refresh token and blocklists the old one', async () => {
      usersService.findByEmail!.mockResolvedValue(null);
      usersService.create!.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        fullName: 'A',
      } as any);
      usersService.findById!.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        fullName: 'A',
      } as any);
      const { refreshToken } = await service.register({
        email: 'a@b.com',
        password: 'password123',
        fullName: 'A',
      });

      const result = await service.refresh(refreshToken);
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).not.toEqual(refreshToken);
      expect(redis.set).toHaveBeenCalled(); // old jti blocklisted
    });
  });
});
