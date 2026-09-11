import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkspaceMember } from '../../workspaces/entities/workspace-member.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column()
  fullName: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ nullable: true, select: false })
  emailVerificationToken?: string;

  @Column({ nullable: true, select: false })
  passwordResetToken?: string;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  passwordResetExpiresAt?: Date;

  @OneToMany(() => WorkspaceMember, (member) => member.user)
  memberships: WorkspaceMember[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
