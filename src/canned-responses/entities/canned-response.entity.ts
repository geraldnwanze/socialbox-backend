import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Workspace } from '../../workspaces/entities/workspace.entity';

/** A saved reply an agent can insert into the composer by typing "/" + its shortcut. */
@Entity('canned_responses')
@Index(['workspaceId', 'shortcut'], { unique: true })
export class CannedResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column()
  title: string;

  /** Lowercase slug typed after "/" in the composer, e.g. "shipping". Unique per workspace. */
  @Column()
  shortcut: string;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
