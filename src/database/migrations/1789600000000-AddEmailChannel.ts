import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailChannel1789600000000 implements MigrationInterface {
  name = 'AddEmailChannel1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."channel_connections_type_enum" ADD VALUE IF NOT EXISTS 'EMAIL'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."contact_identities_channel_enum" ADD VALUE IF NOT EXISTS 'EMAIL'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres can't drop a single enum value; leaving it is harmless.
  }
}
