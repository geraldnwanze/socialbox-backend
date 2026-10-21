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
import { AutomationAction, AutomationCondition } from '../automation.types';

/** "When a customer message matches these conditions, do these actions." Evaluated in `position` order. */
@Entity('automation_rules')
@Index(['workspaceId', 'enabled', 'position'])
export class AutomationRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column()
  name: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'jsonb', default: [] })
  conditions: AutomationCondition[];

  @Column({ type: 'jsonb', default: [] })
  actions: AutomationAction[];

  @Column({ type: 'int', default: 0 })
  triggerCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastTriggeredAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
