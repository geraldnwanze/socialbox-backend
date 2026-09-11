import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1789168468215 implements MigrationInterface {
  name = 'InitialSchema1789168468215';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "full_name" character varying NOT NULL, "avatar_url" character varying, "email_verified" boolean NOT NULL DEFAULT false, "email_verification_token" character varying, "password_reset_token" character varying, "password_reset_expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_members_role_enum" AS ENUM('OWNER', 'ADMIN', 'AGENT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "workspace_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "public"."workspace_members_role_enum" NOT NULL DEFAULT 'AGENT', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_22ab43ac5865cd62769121d2bc4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4896b609c71ca5ad20ad662077" ON "workspace_members" ("workspace_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "slug" character varying NOT NULL, "logo_url" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b8e9fe62e93d60089dfc4f175f" ON "workspaces" ("slug") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."webhook_events_status_enum" AS ENUM('PENDING', 'PROCESSED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "webhook_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" character varying NOT NULL, "channel_connection_id" uuid, "external_event_id" character varying NOT NULL, "raw_payload" jsonb NOT NULL, "status" "public"."webhook_events_status_enum" NOT NULL DEFAULT 'PENDING', "error_message" character varying, "processed_at" TIMESTAMP WITH TIME ZONE, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4cba37e6a0acb5e1fc49c34ebfd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3be1ff505bee133163c6e85fd2" ON "webhook_events" ("provider", "external_event_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tags" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "name" character varying NOT NULL, "color" character varying NOT NULL DEFAULT '#6366F1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e7dc17249a1148a1970748eda99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9314fe33e6d22aad5125f05b77" ON "tags" ("workspace_id", "name") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."channel_connections_type_enum" AS ENUM('WHATSAPP', 'TELEGRAM', 'FACEBOOK_MESSENGER', 'INSTAGRAM', 'X', 'TIKTOK')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."channel_connections_status_enum" AS ENUM('CONNECTED', 'DISCONNECTED', 'ERROR', 'PENDING')`,
    );
    await queryRunner.query(
      `CREATE TABLE "channel_connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "type" "public"."channel_connections_type_enum" NOT NULL, "provider" character varying NOT NULL, "status" "public"."channel_connections_status_enum" NOT NULL DEFAULT 'PENDING', "external_account_id" character varying, "external_account_name" character varying, "encrypted_credentials" text, "token_expires_at" TIMESTAMP WITH TIME ZONE, "metadata" jsonb NOT NULL DEFAULT '{}', "last_error_message" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2ae1fe901084592fd4d6795faea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46ad4a3e84d1d09cf6e98e093c" ON "channel_connections" ("workspace_id", "type") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contact_identities_channel_enum" AS ENUM('WHATSAPP', 'TELEGRAM', 'FACEBOOK_MESSENGER', 'INSTAGRAM', 'X', 'TIKTOK')`,
    );
    await queryRunner.query(
      `CREATE TABLE "contact_identities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "contact_id" uuid NOT NULL, "workspace_id" uuid NOT NULL, "channel" "public"."contact_identities_channel_enum" NOT NULL, "channel_connection_id" uuid NOT NULL, "external_user_id" character varying NOT NULL, "username" character varying, "display_name" character varying, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_38de992d13ad0ef3975ca176935" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a120db577cdc03052a43cb0459" ON "contact_identities" ("channel_connection_id", "external_user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "contacts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "display_name" character varying, "avatar_url" character varying, "email" character varying, "phone" character varying, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b99cd40cfd66a99f1571f4f72e6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a65be64e40ceb2856e46cb9f8a" ON "contacts" ("workspace_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_status_enum" AS ENUM('OPEN', 'PENDING', 'RESOLVED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "channel_connection_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "external_conversation_id" character varying NOT NULL, "status" "public"."conversations_status_enum" NOT NULL DEFAULT 'OPEN', "assigned_to" uuid, "last_message_at" TIMESTAMP WITH TIME ZONE, "last_message_preview" character varying, "unread_count" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_370b9333f5545bcef1ed787089" ON "conversations" ("channel_connection_id", "external_conversation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d660e90e83d4d77686ccc6aeb" ON "conversations" ("workspace_id", "last_message_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f303f9c10cbbf5362d8c1f5827" ON "conversations" ("workspace_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation_tags" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "tag_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_de5600810661b03917dba76854b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d6a23438eb19986e6047c555ba" ON "conversation_tags" ("conversation_id", "tag_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_type_enum" AS ENUM('CONVERSATION_ASSIGNED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "type" "public"."notifications_type_enum" NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "read_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8385e7e4b0c91cfa308cba3f13" ON "notifications" ("workspace_id", "user_id", "read_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "message_attachments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message_id" uuid NOT NULL, "storage_key" character varying, "mime_type" character varying, "file_name" character varying, "file_size" bigint, "source_url" character varying, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e5085d973567c61e9306f10f95b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."messages_sender_type_enum" AS ENUM('CONTACT', 'AGENT', 'SYSTEM')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."messages_direction_enum" AS ENUM('INBOUND', 'OUTBOUND')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."messages_message_type_enum" AS ENUM('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'SYSTEM', 'UNKNOWN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."messages_status_enum" AS ENUM('RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "channel_connection_id" uuid NOT NULL, "external_message_id" character varying, "sender_type" "public"."messages_sender_type_enum" NOT NULL, "sender_external_id" character varying, "sender_member_id" uuid, "direction" "public"."messages_direction_enum" NOT NULL, "message_type" "public"."messages_message_type_enum" NOT NULL DEFAULT 'TEXT', "content" text, "status" "public"."messages_status_enum" NOT NULL, "failure_reason" character varying, "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_91bfd447e70443192fc0aa9e29" ON "messages" ("channel_connection_id", "external_message_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8584a1974e1ca95f4861d975ff" ON "messages" ("conversation_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation_participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "contact_identity_id" uuid NOT NULL, "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_61b51428ad9453f5921369fbe94" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_700392fd112786660dbf2cc18a" ON "conversation_participants" ("conversation_id", "contact_identity_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation_assignments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "assigned_to_id" uuid, "assigned_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ab4027086b9efefe4f522288bed" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_caf43c5a2d0014523418843ec5" ON "conversation_assignments" ("conversation_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_4a7c584ddfe855379598b5e20fd" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_4e83431119fa585fc7aa8b817db" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tags" ADD CONSTRAINT "FK_3352c57d71fe58f703b8966caee" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_connections" ADD CONSTRAINT "FK_fef25dfbe78c2091c9c787e4d4c" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_identities" ADD CONSTRAINT "FK_1d4a95cd88e42cb1ec58e5bc952" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_identities" ADD CONSTRAINT "FK_90407760ed8385ca40b97e32c80" FOREIGN KEY ("channel_connection_id") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contacts" ADD CONSTRAINT "FK_a65be64e40ceb2856e46cb9f8a8" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_2136015a4b73fb4898773f2226f" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_187f3955efabb41054ca08ac1a8" FOREIGN KEY ("channel_connection_id") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_3e605129623b629ddd0583740db" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_eff6596193e3e64a04433368f28" FOREIGN KEY ("assigned_to") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_tags" ADD CONSTRAINT "FK_3c627a7d45d66262ae48c1584ae" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_tags" ADD CONSTRAINT "FK_9e50bf0c55a7252a73fb03f397f" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_attachments" ADD CONSTRAINT "FK_bf65c3db8657cef6197b68b8c88" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_a5f6c7c292ce646cfca2728b322" FOREIGN KEY ("sender_member_id") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participants" ADD CONSTRAINT "FK_1559e8a16b828f2e836a2312800" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participants" ADD CONSTRAINT "FK_1d3987a4ba1399ad730632f7adb" FOREIGN KEY ("contact_identity_id") REFERENCES "contact_identities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_assignments" ADD CONSTRAINT "FK_caf43c5a2d0014523418843ec5b" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_assignments" ADD CONSTRAINT "FK_143ee76dd3db508a4a3bd45829a" FOREIGN KEY ("assigned_to_id") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_assignments" ADD CONSTRAINT "FK_55a613978430f6464b7eee708f5" FOREIGN KEY ("assigned_by_id") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversation_assignments" DROP CONSTRAINT "FK_55a613978430f6464b7eee708f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_assignments" DROP CONSTRAINT "FK_143ee76dd3db508a4a3bd45829a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_assignments" DROP CONSTRAINT "FK_caf43c5a2d0014523418843ec5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participants" DROP CONSTRAINT "FK_1d3987a4ba1399ad730632f7adb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participants" DROP CONSTRAINT "FK_1559e8a16b828f2e836a2312800"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_a5f6c7c292ce646cfca2728b322"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_attachments" DROP CONSTRAINT "FK_bf65c3db8657cef6197b68b8c88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_tags" DROP CONSTRAINT "FK_9e50bf0c55a7252a73fb03f397f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_tags" DROP CONSTRAINT "FK_3c627a7d45d66262ae48c1584ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_eff6596193e3e64a04433368f28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_3e605129623b629ddd0583740db"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_187f3955efabb41054ca08ac1a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_2136015a4b73fb4898773f2226f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contacts" DROP CONSTRAINT "FK_a65be64e40ceb2856e46cb9f8a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_identities" DROP CONSTRAINT "FK_90407760ed8385ca40b97e32c80"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_identities" DROP CONSTRAINT "FK_1d4a95cd88e42cb1ec58e5bc952"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_connections" DROP CONSTRAINT "FK_fef25dfbe78c2091c9c787e4d4c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tags" DROP CONSTRAINT "FK_3352c57d71fe58f703b8966caee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" DROP CONSTRAINT "FK_4e83431119fa585fc7aa8b817db"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" DROP CONSTRAINT "FK_4a7c584ddfe855379598b5e20fd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_caf43c5a2d0014523418843ec5"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_assignments"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_700392fd112786660dbf2cc18a"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_participants"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8584a1974e1ca95f4861d975ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_91bfd447e70443192fc0aa9e29"`,
    );
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TYPE "public"."messages_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."messages_message_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."messages_direction_enum"`);
    await queryRunner.query(`DROP TYPE "public"."messages_sender_type_enum"`);
    await queryRunner.query(`DROP TABLE "message_attachments"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8385e7e4b0c91cfa308cba3f13"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6a23438eb19986e6047c555ba"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_tags"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f303f9c10cbbf5362d8c1f5827"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d660e90e83d4d77686ccc6aeb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_370b9333f5545bcef1ed787089"`,
    );
    await queryRunner.query(`DROP TABLE "conversations"`);
    await queryRunner.query(`DROP TYPE "public"."conversations_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a65be64e40ceb2856e46cb9f8a"`,
    );
    await queryRunner.query(`DROP TABLE "contacts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a120db577cdc03052a43cb0459"`,
    );
    await queryRunner.query(`DROP TABLE "contact_identities"`);
    await queryRunner.query(
      `DROP TYPE "public"."contact_identities_channel_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46ad4a3e84d1d09cf6e98e093c"`,
    );
    await queryRunner.query(`DROP TABLE "channel_connections"`);
    await queryRunner.query(
      `DROP TYPE "public"."channel_connections_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."channel_connections_type_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9314fe33e6d22aad5125f05b77"`,
    );
    await queryRunner.query(`DROP TABLE "tags"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3be1ff505bee133163c6e85fd2"`,
    );
    await queryRunner.query(`DROP TABLE "webhook_events"`);
    await queryRunner.query(`DROP TYPE "public"."webhook_events_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8e9fe62e93d60089dfc4f175f"`,
    );
    await queryRunner.query(`DROP TABLE "workspaces"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4896b609c71ca5ad20ad662077"`,
    );
    await queryRunner.query(`DROP TABLE "workspace_members"`);
    await queryRunner.query(`DROP TYPE "public"."workspace_members_role_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
