import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async create(input: {
    email: string;
    passwordHash: string;
    fullName: string;
  }): Promise<User> {
    const user = this.users.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      fullName: input.fullName,
    });
    return this.users.save(user);
  }

  async setPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.users.update(userId, {
      passwordResetToken: tokenHash,
      passwordResetExpiresAt: expiresAt,
    });
  }

  findByPasswordResetToken(tokenHash: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect([
        'user.passwordResetToken',
        'user.passwordResetExpiresAt',
        'user.passwordHash',
      ])
      .where('user.passwordResetToken = :tokenHash', { tokenHash })
      .getOne();
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.users.update(userId, {
      passwordHash,
      passwordResetToken: null as unknown as string,
      passwordResetExpiresAt: null as unknown as Date,
    });
  }
}
