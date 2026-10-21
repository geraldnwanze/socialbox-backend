import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationResolvedAt1789500000000 implements MigrationInterface {
  name = 'AddConversationResolvedAt1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "resolved_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Best available approximation for conversations resolved before this column existed.
    await queryRunner.query(
      `UPDATE "conversations" SET "resolved_at" = "updated_at" WHERE "status" = 'RESOLVED'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_workspace_resolved_at" ON "conversations" ("workspace_id", "resolved_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversations_workspace_resolved_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN "resolved_at"`,
    );
  }
}
