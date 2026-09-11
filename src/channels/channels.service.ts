import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelConnection } from './entities/channel-connection.entity';
import {
  ChannelConnectionStatus,
  ChannelType,
} from './enums/channel-type.enum';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';

const UNSUPPORTED_CHANNELS: { type: ChannelType; reason: string }[] = [
  {
    type: ChannelType.TIKTOK,
    reason: 'Planned — pending TikTok Business Partner approval',
  },
];

const PENDING_CHANNELS: { type: ChannelType; reason: string }[] = [
  { type: ChannelType.X, reason: 'Pending — requires a billed X API account' },
];

@Injectable()
export class ChannelsService {
  constructor(
    @InjectRepository(ChannelConnection)
    private readonly connections: Repository<ChannelConnection>,
    private readonly registry: ChannelAdapterRegistry,
    private readonly encryptionService: EncryptionService,
  ) {}

  /** Every channel type the product knows about, whether or not it's actually connectable. */
  listChannelCatalog() {
    // XAdapter is registered so ChannelsService.connect() can resolve it and surface a clear
    // "not implemented" error, but it must not show up as a real, connectable channel here.
    const nonConnectable = new Set(
      [...PENDING_CHANNELS, ...UNSUPPORTED_CHANNELS].map((c) => c.type),
    );

    const available = this.registry
      .getAvailableTypes()
      .filter((type) => !nonConnectable.has(type))
      .map((type) => ({
        type,
        available: true,
        capabilities: this.registry.get(type).capabilities,
      }));
    const pending = PENDING_CHANNELS.map((c) => ({
      type: c.type,
      available: false,
      reason: c.reason,
    }));
    const unsupported = UNSUPPORTED_CHANNELS.map((c) => ({
      type: c.type,
      available: false,
      reason: c.reason,
    }));
    return [...available, ...pending, ...unsupported];
  }

  async listForWorkspace(workspaceId: string): Promise<ChannelConnection[]> {
    return this.connections.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });
  }

  async findOneForWorkspace(
    workspaceId: string,
    id: string,
  ): Promise<ChannelConnection> {
    const connection = await this.connections.findOne({
      where: { id, workspaceId },
    });
    if (!connection) throw new ResourceNotFoundException('Channel connection');
    return connection;
  }

  /** Loads a connection with its encrypted credentials decrypted and attached in-memory. */
  async loadWithCredentials(id: string): Promise<ChannelConnection> {
    const connection = await this.connections
      .createQueryBuilder('cc')
      .addSelect('cc.encryptedCredentials')
      .where('cc.id = :id', { id })
      .getOne();
    if (!connection) throw new ResourceNotFoundException('Channel connection');
    if (connection.encryptedCredentials) {
      connection.credentials = JSON.parse(
        this.encryptionService.decrypt(connection.encryptedCredentials),
      );
    }
    return connection;
  }

  async connect(
    workspaceId: string,
    type: ChannelType,
    credentials: Record<string, unknown>,
  ): Promise<ChannelConnection> {
    const adapter = this.registry.get(type);
    const result = await adapter.connect(credentials);

    const connection = await this.connections.save(
      this.connections.create({
        workspaceId,
        type,
        provider: adapter.constructor.name,
        status: ChannelConnectionStatus.CONNECTED,
        externalAccountId: result.externalAccountId,
        externalAccountName: result.externalAccountName,
        encryptedCredentials: this.encryptionService.encrypt(
          JSON.stringify(result.credentials),
        ),
        metadata: result.metadata ?? {},
        tokenExpiresAt: result.tokenExpiresAt,
      }),
    );

    if (adapter.configureWebhook) {
      connection.credentials = result.credentials;
      await adapter.configureWebhook(connection);
    }

    return this.sanitize(connection);
  }

  async reconnect(
    workspaceId: string,
    id: string,
    credentials: Record<string, unknown>,
  ): Promise<ChannelConnection> {
    const existing = await this.findOneForWorkspace(workspaceId, id);
    const adapter = this.registry.get(existing.type);
    const result = await adapter.connect(credentials);

    existing.status = ChannelConnectionStatus.CONNECTED;
    existing.externalAccountId = result.externalAccountId;
    existing.externalAccountName =
      result.externalAccountName ?? existing.externalAccountName;
    existing.encryptedCredentials = this.encryptionService.encrypt(
      JSON.stringify(result.credentials),
    );
    existing.metadata = result.metadata ?? existing.metadata;
    existing.tokenExpiresAt = result.tokenExpiresAt;
    existing.lastErrorMessage = undefined;
    const saved = await this.connections.save(existing);

    if (adapter.configureWebhook) {
      saved.credentials = result.credentials;
      await adapter.configureWebhook(saved);
    }

    return this.sanitize(saved);
  }

  async disconnect(workspaceId: string, id: string): Promise<void> {
    const connection = await this.loadWithCredentials(id);
    if (connection.workspaceId !== workspaceId)
      throw new ResourceNotFoundException('Channel connection');

    const adapter = this.registry.find(connection.type);
    if (adapter) {
      await adapter.disconnect(connection).catch(() => undefined);
    }

    connection.status = ChannelConnectionStatus.DISCONNECTED;
    connection.encryptedCredentials = undefined;
    await this.connections.save(connection);
  }

  async findByExternalAccountId(
    type: ChannelType,
    externalAccountId: string,
  ): Promise<ChannelConnection | null> {
    return this.connections.findOne({
      where: {
        type,
        externalAccountId,
        status: ChannelConnectionStatus.CONNECTED,
      },
    });
  }

  async markError(id: string, message: string): Promise<void> {
    await this.connections.update(id, {
      status: ChannelConnectionStatus.ERROR,
      lastErrorMessage: message,
    });
  }

  /** Never let encrypted credentials leave the service layer. */
  sanitize(connection: ChannelConnection): ChannelConnection {
    const {
      encryptedCredentials: _omit,
      credentials: _omit2,
      ...rest
    } = connection;
    return rest as ChannelConnection;
  }
}
