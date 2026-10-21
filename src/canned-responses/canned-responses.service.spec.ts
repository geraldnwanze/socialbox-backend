import { ConflictException } from '@nestjs/common';
import { CannedResponsesService } from './canned-responses.service';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';

describe('CannedResponsesService', () => {
  function build(overrides: Record<string, jest.Mock> = {}) {
    const repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'r-1', ...v })),
      remove: jest.fn(),
      ...overrides,
    };
    return { service: new CannedResponsesService(repo as never), repo };
  }

  it("only lists the requesting workspace's replies", async () => {
    const { service, repo } = build();
    await service.list('ws-1');
    expect(repo.find).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      order: { title: 'ASC' },
    });
  });

  it('turns a duplicate shortcut into a clear 409 instead of a raw database error', async () => {
    const { service } = build({
      save: jest.fn().mockRejectedValue({ code: '23505' }),
    });
    await expect(
      service.create('ws-1', {
        title: 'Shipping',
        shortcut: 'shipping',
        content: 'x',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rethrows unrelated database errors untouched', async () => {
    const boom = new Error('connection lost');
    const { service } = build({ save: jest.fn().mockRejectedValue(boom) });
    await expect(
      service.create('ws-1', { title: 'a', shortcut: 'a', content: 'x' }),
    ).rejects.toBe(boom);
  });

  it("cannot update or delete another workspace's reply (lookup is scoped by workspace)", async () => {
    const { service, repo } = build({
      findOne: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.update('ws-1', 'r-9', { title: 'new' }),
    ).rejects.toThrow(ResourceNotFoundException);
    await expect(service.remove('ws-1', 'r-9')).rejects.toThrow(
      ResourceNotFoundException,
    );
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'r-9', workspaceId: 'ws-1' },
    });
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('applies partial updates to the existing record', async () => {
    const existing = {
      id: 'r-1',
      workspaceId: 'ws-1',
      title: 'Old',
      shortcut: 'old',
      content: 'c',
    };
    const { service, repo } = build({
      findOne: jest.fn().mockResolvedValue(existing),
    });

    await service.update('ws-1', 'r-1', { title: 'New' });

    expect(repo.save).toHaveBeenCalledWith({ ...existing, title: 'New' });
  });
});
