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
import { WorkspaceMember } from '../../workspaces/entities/workspace-member.entity';
import { InboxViewFilters } from '../inbox-view.types';

/** A saved inbox filter. Private to its creator unless an admin shares it with the whole team. */
@Entity('inbox_views')
@Index(['workspaceId', 'shared'])
export class InboxView {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column('uuid')
  ownerMemberId: string;

  @ManyToOne(() => WorkspaceMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_member_id' })
  owner: WorkspaceMember;

  @Column()
  name: string;

  @Column({ default: false })
  shared: boolean;

  @Column({ type: 'jsonb', default: {} })
  filters: InboxViewFilters;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
