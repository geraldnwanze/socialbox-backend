import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { customAlphabet } from 'nanoid';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import { UsersService } from '../users/users.service';
import { slugify } from '../common/utils/slug';
import {
  ResourceNotFoundException,
  WorkspaceAccessDeniedException,
} from '../common/exceptions/app.exception';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6);

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    private readonly usersService: UsersService,
  ) {}

  async create(userId: string, name: string): Promise<Workspace> {
    let slug = slugify(name);
    if (!slug) slug = 'workspace';
    while (await this.workspaces.findOne({ where: { slug } })) {
      slug = `${slugify(name)}-${nanoid()}`;
    }

    const workspace = await this.workspaces.save(
      this.workspaces.create({ name, slug }),
    );
    await this.members.save(
      this.members.create({
        workspaceId: workspace.id,
        userId,
        role: WorkspaceRole.OWNER,
      }),
    );
    return workspace;
  }

  async findForUser(
    userId: string,
  ): Promise<(Workspace & { role: WorkspaceRole })[]> {
    const memberships = await this.members.find({
      where: { userId },
      relations: ['workspace'],
    });
    return memberships.map((m) => ({ ...m.workspace, role: m.role }));
  }

  async findOneForUser(
    userId: string,
    workspaceId: string,
  ): Promise<Workspace & { role: WorkspaceRole }> {
    const membership = await this.members.findOne({
      where: { userId, workspaceId },
      relations: ['workspace'],
    });
    if (!membership) throw new WorkspaceAccessDeniedException();
    return { ...membership.workspace, role: membership.role };
  }

  async updateSettings(
    workspaceId: string,
    settings: { sendReadReceipts?: boolean },
  ): Promise<Workspace> {
    const workspace = await this.workspaces.findOne({
      where: { id: workspaceId },
    });
    if (!workspace) throw new ResourceNotFoundException('Workspace');
    if (settings.sendReadReceipts !== undefined) {
      workspace.sendReadReceipts = settings.sendReadReceipts;
    }
    return this.workspaces.save(workspace);
  }

  listMembers(workspaceId: string) {
    return this.members.find({
      where: { workspaceId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  async addMember(
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new BadRequestException(
        'No account exists with that email yet — ask them to register first, then add them again.',
      );
    }

    const existing = await this.members.findOne({
      where: { workspaceId, userId: user.id },
    });
    if (existing) {
      throw new BadRequestException(
        'This person is already a member of the workspace',
      );
    }

    const member = this.members.create({ workspaceId, userId: user.id, role });
    return this.members.save(member);
  }

  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    const member = await this.members.findOne({
      where: { id: memberId, workspaceId },
    });
    if (!member) throw new ResourceNotFoundException('Workspace member');

    if (member.role === WorkspaceRole.OWNER && role !== WorkspaceRole.OWNER) {
      await this.assertNotLastOwner(workspaceId);
    }

    member.role = role;
    return this.members.save(member);
  }

  async removeMember(workspaceId: string, memberId: string): Promise<void> {
    const member = await this.members.findOne({
      where: { id: memberId, workspaceId },
    });
    if (!member) throw new ResourceNotFoundException('Workspace member');

    if (member.role === WorkspaceRole.OWNER) {
      await this.assertNotLastOwner(workspaceId);
    }

    await this.members.remove(member);
  }

  private async assertNotLastOwner(workspaceId: string): Promise<void> {
    const ownerCount = await this.members.count({
      where: { workspaceId, role: WorkspaceRole.OWNER },
    });
    if (ownerCount <= 1) {
      throw new BadRequestException(
        'A workspace must always have at least one owner',
      );
    }
  }
}
