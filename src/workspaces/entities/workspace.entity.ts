import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkspaceMember } from './workspace-member.entity';

@Entity('workspaces')
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Column({ nullable: true })
  logoUrl?: string;

  /** Tell customers when an agent has read their message (WhatsApp/Messenger "seen", live chat
   *  "Seen"). Marking mail read inside the agents' own mailbox is not affected. */
  @Column({ default: true })
  sendReadReceipts: boolean;

  /** Lets agents use AI assist, which sends the conversation being worked on to Anthropic. Off until an admin opts in. */
  @Column({ default: false })
  aiAssistEnabled: boolean;

  @OneToMany(() => WorkspaceMember, (member) => member.workspace)
  members: WorkspaceMember[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
