import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CannedResponse } from './entities/canned-response.entity';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class CannedResponsesService {
  constructor(
    @InjectRepository(CannedResponse)
    private readonly responses: Repository<CannedResponse>,
  ) {}

  list(workspaceId: string) {
    return this.responses.find({
      where: { workspaceId },
      order: { title: 'ASC' },
    });
  }

  async create(
    workspaceId: string,
    input: { title: string; shortcut: string; content: string },
  ): Promise<CannedResponse> {
    try {
      return await this.responses.save(
        this.responses.create({ workspaceId, ...input }),
      );
    } catch (error) {
      throw this.translate(error, input.shortcut);
    }
  }

  async update(
    workspaceId: string,
    id: string,
    changes: { title?: string; shortcut?: string; content?: string },
  ): Promise<CannedResponse> {
    const existing = await this.responses.findOne({
      where: { id, workspaceId },
    });
    if (!existing) throw new ResourceNotFoundException('Canned response');
    Object.assign(existing, changes);
    try {
      return await this.responses.save(existing);
    } catch (error) {
      throw this.translate(error, changes.shortcut ?? existing.shortcut);
    }
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const existing = await this.responses.findOne({
      where: { id, workspaceId },
    });
    if (!existing) throw new ResourceNotFoundException('Canned response');
    await this.responses.remove(existing);
  }

  // The unique index is the source of truth: checking first and then inserting would race.
  private translate(error: unknown, shortcut: string): unknown {
    if ((error as { code?: string })?.code === UNIQUE_VIOLATION) {
      return new ConflictException(
        `The shortcut "/${shortcut}" is already in use`,
      );
    }
    return error;
  }
}
