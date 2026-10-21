import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCannedResponses1789300000000 implements MigrationInterface {
  name = 'AddCannedResponses1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "canned_responses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "title" character varying NOT NULL, "shortcut" character varying NOT NULL, "content" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_canned_responses_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_canned_responses_workspace_shortcut" ON "canned_responses" ("workspace_id", "shortcut")`,
    );
    await queryRunner.query(
      `ALTER TABLE "canned_responses" ADD CONSTRAINT "FK_canned_responses_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "canned_responses"`);
  }
}
