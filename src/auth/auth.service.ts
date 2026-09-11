import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const SALT_ROUNDS = 12;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private toSafeUser(user: User): SafeUser {
    return { id: user.id, email: user.email, fullName: user.fullName };
  }

  async register(dto: RegisterDto): Promise<{ user: SafeUser } & TokenPair> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
    });

    const tokens = await this.issueTokens(user);
    return { user: this.toSafeUser(user), ...tokens };
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }

  async login(dto: LoginDto): Promise<{ user: SafeUser } & TokenPair> {
    const user = await this.validateUser(dto.email, dto.password);
    const tokens = await this.issueTokens(user);
    return { user: this.toSafeUser(user), ...tokens };
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, type: 'access' },
      {
        secret: this.configService.get<string>('auth.jwtSecret'),
        expiresIn: this.configService.get<string>('auth.jwtAccessTtl'),
      },
    );

    const jti = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, type: 'refresh', jti },
      {
        secret: this.configService.get<string>('auth.jwtRefreshSecret'),
        expiresIn: this.configService.get<string>('auth.jwtRefreshTtl'),
      },
    );

    return { accessToken, refreshToken };
  }

  private blocklistKey(jti: string) {
    return `auth:refresh-blocklist:${jti}`;
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: {
      sub: string;
      email: string;
      type: string;
      jti: string;
      exp: number;
    };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('auth.jwtRefreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const isBlocklisted = await this.redis.exists(
      this.blocklistKey(payload.jti),
    );
    if (isBlocklisted) {
      throw new UnauthorizedException('Refresh token has already been used');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Single-use refresh tokens: rotate on every refresh and blocklist the one just used until
    // its original expiry, so a leaked-but-already-used token can't be replayed.
    const ttlSeconds = Math.max(payload.exp - Math.floor(Date.now() / 1000), 0);
    if (ttlSeconds > 0) {
      await this.redis.set(
        this.blocklistKey(payload.jti),
        '1',
        'EX',
        ttlSeconds,
      );
    }

    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        jti: string;
        exp: number;
      }>(refreshToken, {
        secret: this.configService.get<string>('auth.jwtRefreshSecret'),
      });
      const ttlSeconds = Math.max(
        payload.exp - Math.floor(Date.now() / 1000),
        0,
      );
      if (ttlSeconds > 0) {
        await this.redis.set(
          this.blocklistKey(payload.jti),
          '1',
          'EX',
          ttlSeconds,
        );
      }
    } catch {
      // Already invalid/expired — logout is a no-op in that case, nothing to revoke.
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Do not reveal whether the email exists.
      return;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.usersService.setPasswordResetToken(
      user.id,
      tokenHash,
      new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    );

    // No email provider is configured for this MVP (see README) — logging the token locally
    // is a development-only stand-in. Wiring a transactional email provider is the only step
    // needed to make this a real "forgot password" email.
    this.logger.debug(
      `Password reset requested for ${email}. Reset token: ${rawToken}`,
    );
  }

  async confirmPasswordReset(
    token: string,
    newPassword: string,
  ): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = await this.usersService.findByPasswordResetToken(tokenHash);
    if (
      !user ||
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt < new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.usersService.updatePassword(user.id, passwordHash);
  }
}
