import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLiveChatChannel1789200000000 implements MigrationInterface {
  name = 'AddLiveChatChannel1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."channel_connections_type_enum" ADD VALUE IF NOT EXISTS 'LIVE_CHAT'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."contact_identities_channel_enum" ADD VALUE IF NOT EXISTS 'LIVE_CHAT'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres can't drop a single enum value; leaving it is harmless.
  }
}
