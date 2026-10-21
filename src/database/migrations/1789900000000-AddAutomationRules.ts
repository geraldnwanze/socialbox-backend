import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationRules1789900000000 implements MigrationInterface {
  name = 'AddAutomationRules1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "automation_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "name" character varying NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "position" integer NOT NULL DEFAULT 0, "conditions" jsonb NOT NULL DEFAULT '[]', "actions" jsonb NOT NULL DEFAULT '[]', "trigger_count" integer NOT NULL DEFAULT 0, "last_triggered_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_automation_rules_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_rules_workspace_enabled_position" ON "automation_rules" ("workspace_id", "enabled", "position")`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_rules" ADD CONSTRAINT "FK_automation_rules_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Rules assign conversations too, and there is no agent behind those.
    await queryRunner.query(
      `ALTER TABLE "conversation_assignments" ALTER COLUMN "assigned_by_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "automation_rules"`);
    await queryRunner.query(
      `ALTER TABLE "conversation_assignments" ALTER COLUMN "assigned_by_id" SET NOT NULL`,
    );
  }
}
