import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInboxViews1790000000000 implements MigrationInterface {
  name = 'AddInboxViews1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "inbox_views" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "owner_member_id" uuid NOT NULL, "name" character varying NOT NULL, "shared" boolean NOT NULL DEFAULT false, "filters" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_inbox_views_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inbox_views_workspace_shared" ON "inbox_views" ("workspace_id", "shared")`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbox_views" ADD CONSTRAINT "FK_inbox_views_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbox_views" ADD CONSTRAINT "FK_inbox_views_owner" FOREIGN KEY ("owner_member_id") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "inbox_views"`);
  }
}
