import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { conversationRoom, userRoom, workspaceRoom } from './realtime.events';

interface SocketAuth {
  token?: string;
  workspaceId?: string;
}

/**
 * A socket only ever joins `workspace:{id}` for a workspace it has verified membership of at
 * connection time, and can only join a `conversation:{id}` room after this gateway confirms
 * that conversation belongs to that same workspace — so one workspace's agents can never
 * subscribe to another workspace's rooms even if they guess an id.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(WorkspaceMember)
    private readonly workspaceMembers: Repository<WorkspaceMember>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const auth = client.handshake.auth as SocketAuth;
      if (!auth.token || !auth.workspaceId) throw new UnauthorizedException();

      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        type: string;
      }>(auth.token, {
        secret: this.configService.get<string>('auth.jwtSecret'),
      });
      if (payload.type !== 'access') throw new UnauthorizedException();

      const membership = await this.workspaceMembers.findOne({
        where: { userId: payload.sub, workspaceId: auth.workspaceId },
      });
      if (!membership) throw new UnauthorizedException();

      client.data.userId = payload.sub;
      client.data.workspaceId = auth.workspaceId;
      await client.join(workspaceRoom(auth.workspaceId));
      await client.join(userRoom(payload.sub));
    } catch {
      this.logger.warn(
        `Rejecting unauthenticated socket connection ${client.id}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket) {
    // Socket.IO automatically leaves all rooms on disconnect — nothing else to clean up.
  }

  @SubscribeMessage('join_conversation')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const workspaceId = client.data.workspaceId;
    if (!workspaceId || !data?.conversationId) return;

    const conversation = await this.conversations.findOne({
      where: { id: data.conversationId, workspaceId },
    });
    if (!conversation) return;

    await client.join(conversationRoom(conversation.id));
  }

  @SubscribeMessage('leave_conversation')
  async leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (data?.conversationId)
      await client.leave(conversationRoom(data.conversationId));
  }
}
