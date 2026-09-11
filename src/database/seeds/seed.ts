import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import * as bcrypt from 'bcrypt';
import { User } from '../../users/entities/user.entity';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { WorkspaceMember } from '../../workspaces/entities/workspace-member.entity';
import { Tag } from '../../tags/entities/tag.entity';
import { WorkspaceRole } from '../../common/enums/workspace-role.enum';

config();

/**
 * Local development seed data only — per the spec, no fake "production" social messages are
 * ever seeded. Safe to run repeatedly: it upserts by email/slug instead of blindly inserting.
 */
async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    namingStrategy: new SnakeNamingStrategy(),
    entities: ['src/**/*.entity.ts'],
  });
  await dataSource.initialize();

  const users = dataSource.getRepository(User);
  const workspaces = dataSource.getRepository(Workspace);
  const members = dataSource.getRepository(WorkspaceMember);
  const tags = dataSource.getRepository(Tag);

  const passwordHash = await bcrypt.hash('password123', 12);

  let owner = await users.findOne({ where: { email: 'owner@demo.socialbox.local' } });
  if (!owner) {
    owner = await users.save(
      users.create({ email: 'owner@demo.socialbox.local', passwordHash, fullName: 'Demo Owner' }),
    );
    console.log('Created demo owner: owner@demo.socialbox.local / password123');
  }

  let agent = await users.findOne({ where: { email: 'agent@demo.socialbox.local' } });
  if (!agent) {
    agent = await users.save(
      users.create({ email: 'agent@demo.socialbox.local', passwordHash, fullName: 'Demo Agent' }),
    );
    console.log('Created demo agent: agent@demo.socialbox.local / password123');
  }

  let workspace = await workspaces.findOne({ where: { slug: 'demo-workspace' } });
  if (!workspace) {
    workspace = await workspaces.save(workspaces.create({ name: 'Demo Workspace', slug: 'demo-workspace' }));
    console.log(`Created demo workspace: ${workspace.id}`);
  }

  const ensureMember = async (userId: string, role: WorkspaceRole) => {
    const existing = await members.findOne({ where: { workspaceId: workspace!.id, userId } });
    if (!existing) {
      await members.save(members.create({ workspaceId: workspace!.id, userId, role }));
    }
  };
  await ensureMember(owner.id, WorkspaceRole.OWNER);
  await ensureMember(agent.id, WorkspaceRole.AGENT);

  const defaultTags: { name: string; color: string }[] = [
    { name: 'VIP', color: '#F59E0B' },
    { name: 'Lead', color: '#3B82F6' },
    { name: 'Support', color: '#10B981' },
    { name: 'Order', color: '#8B5CF6' },
    { name: 'Refund', color: '#EF4444' },
    { name: 'Follow-up', color: '#6366F1' },
  ];
  for (const tag of defaultTags) {
    const existing = await tags.findOne({ where: { workspaceId: workspace.id, name: tag.name } });
    if (!existing) {
      await tags.save(tags.create({ workspaceId: workspace.id, ...tag }));
    }
  }

  console.log('\nSeed complete. Log in with:');
  console.log('  owner@demo.socialbox.local / password123 (OWNER)');
  console.log('  agent@demo.socialbox.local / password123 (AGENT)');
  console.log(`  Workspace: ${workspace.name} (${workspace.id})`);

  await dataSource.destroy();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
