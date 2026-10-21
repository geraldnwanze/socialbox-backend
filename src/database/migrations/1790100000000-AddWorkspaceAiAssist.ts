import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkspaceAiAssist1790100000000 implements MigrationInterface {
  name = 'AddWorkspaceAiAssist1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "ai_assist_enabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspaces" DROP COLUMN "ai_assist_enabled"`,
    );
  }
}
