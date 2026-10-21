import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { InboxView } from './entities/inbox-view.entity';
import { parseFilters, FilterLookups } from './inbox-views.validation';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { ChannelConnection } from '../channels/entities/channel-connection.entity';
import { Tag } from '../tags/entities/tag.entity';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';
import { CreateInboxViewDto, UpdateInboxViewDto } from './dto/inbox-view.dto';

const MAX_VIEWS_PER_MEMBER = 30;

export interface Actor {
  workspaceId: string;
  memberId: string;
  role: WorkspaceRole;
}

const isAdmin = (role: WorkspaceRole) =>
  role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMIN;

@Injectable()
export class InboxViewsService {
  constructor(
    @InjectRepository(InboxView) private readonly views: Repository<InboxView>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(ChannelConnection)
    private readonly connections: Repository<ChannelConnection>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
  ) {}

  private lookups(workspaceId: string): FilterLookups {
    return {
      channelConnectionExists: (id) =>
        this.connections.exists({ where: { id, workspaceId } }),
      memberExists: (id) => this.members.exists({ where: { id, workspaceId } }),
      tagExists: (id) => this.tags.exists({ where: { id, workspaceId } }),
    };
  }

  /** Shared views plus the caller's own — never anyone else's private ones. */
  async list(actor: Actor) {
    const rows = await this.views
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.owner', 'owner')
      .leftJoinAndSelect('owner.user', 'user')
      .where('v.workspaceId = :workspaceId', { workspaceId: actor.workspaceId })
      .andWhere(
        new Brackets((qb) =>
          qb
            .where('v.shared = true')
            .orWhere('v.ownerMemberId = :me', { me: actor.memberId }),
        ),
      )
      .orderBy('v.shared', 'DESC')
      .addOrderBy('v.name', 'ASC')
      .getMany();
    return rows.map((v) => this.present(v, actor));
  }

  private present(view: InboxView, actor: Actor) {
    return {
      id: view.id,
      name: view.name,
      shared: view.shared,
      filters: view.filters,
      ownerName: view.owner?.user?.fullName ?? null,
      canEdit:
        view.ownerMemberId === actor.memberId ||
        (view.shared && isAdmin(actor.role)),
    };
  }

  async create(actor: Actor, dto: CreateInboxViewDto) {
    if (dto.shared && !isAdmin(actor.role)) {
      throw new ForbiddenException(
        'Only admins can share a view with the team',
      );
    }
    const mine = await this.views.count({
      where: { workspaceId: actor.workspaceId, ownerMemberId: actor.memberId },
    });
    if (mine >= MAX_VIEWS_PER_MEMBER) {
      throw new ForbiddenException(
        `You can save at most ${MAX_VIEWS_PER_MEMBER} views`,
      );
    }
    const filters = await parseFilters(
      dto.filters,
      this.lookups(actor.workspaceId),
    );
    const saved = await this.views.save(
      this.views.create({
        workspaceId: actor.workspaceId,
        ownerMemberId: actor.memberId,
        name: dto.name.trim(),
        shared: dto.shared ?? false,
        filters,
      }),
    );
    return this.present(saved, actor);
  }

  private async findEditable(actor: Actor, id: string): Promise<InboxView> {
    const view = await this.views.findOne({
      where: { id, workspaceId: actor.workspaceId },
    });
    // Someone else's private view must look like it doesn't exist.
    if (!view || (!view.shared && view.ownerMemberId !== actor.memberId)) {
      throw new ResourceNotFoundException('View');
    }
    const mayEdit =
      view.ownerMemberId === actor.memberId ||
      (view.shared && isAdmin(actor.role));
    if (!mayEdit)
      throw new ForbiddenException(
        'Only the creator or an admin can change this view',
      );
    return view;
  }

  async update(actor: Actor, id: string, dto: UpdateInboxViewDto) {
    const view = await this.findEditable(actor, id);
    if (dto.name !== undefined) view.name = dto.name.trim();
    if (dto.filters !== undefined) {
      view.filters = await parseFilters(
        dto.filters,
        this.lookups(actor.workspaceId),
      );
    }
    if (dto.shared !== undefined && dto.shared !== view.shared) {
      if (!isAdmin(actor.role))
        throw new ForbiddenException(
          'Only admins can share a view with the team',
        );
      view.shared = dto.shared;
    }
    return this.present(await this.views.save(view), actor);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const view = await this.findEditable(actor, id);
    await this.views.remove(view);
  }
}
