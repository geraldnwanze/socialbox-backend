import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkspaceReadReceipts1789700000000 implements MigrationInterface {
  name = 'AddWorkspaceReadReceipts1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "send_read_receipts" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP COLUMN "send_read_receipts"`,
    );
  }
}
