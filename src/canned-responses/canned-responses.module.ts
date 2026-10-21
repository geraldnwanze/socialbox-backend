import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CannedResponse } from './entities/canned-response.entity';
import { CannedResponsesService } from './canned-responses.service';
import { CannedResponsesController } from './canned-responses.controller';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [TypeOrmModule.forFeature([CannedResponse]), AccessControlModule],
  controllers: [CannedResponsesController],
  providers: [CannedResponsesService],
})
export class CannedResponsesModule {}
