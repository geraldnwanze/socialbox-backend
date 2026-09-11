import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from './entities/contact.entity';
import { ContactIdentity } from './entities/contact-identity.entity';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, ContactIdentity]),
    AccessControlModule,
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
