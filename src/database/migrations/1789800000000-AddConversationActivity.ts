import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationActivity1789800000000 implements MigrationInterface {
  name = 'AddConversationActivity1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_priority_enum" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT')`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "priority" "public"."conversations_priority_enum" NOT NULL DEFAULT 'NORMAL'`,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "type" character varying NOT NULL, "actor_member_id" uuid, "data" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_conversation_events_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_events_conversation_created" ON "conversation_events" ("conversation_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_events" ADD CONSTRAINT "FK_conversation_events_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_events" ADD CONSTRAINT "FK_conversation_events_actor" FOREIGN KEY ("actor_member_id") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Give existing conversations a history: when they started, and who they were assigned to.
    await queryRunner.query(
      `INSERT INTO "conversation_events" ("workspace_id", "conversation_id", "type", "data", "created_at")
       SELECT "workspace_id", "id", 'CREATED', '{}'::jsonb, "created_at" FROM "conversations"`,
    );
    await queryRunner.query(
      `INSERT INTO "conversation_events" ("workspace_id", "conversation_id", "type", "actor_member_id", "data", "created_at")
       SELECT c."workspace_id", a."conversation_id",
              CASE WHEN a."assigned_to_id" IS NULL THEN 'UNASSIGNED' ELSE 'ASSIGNED' END,
              a."assigned_by_id",
              jsonb_build_object('toMemberId', a."assigned_to_id", 'toName', u."full_name"),
              a."created_at"
       FROM "conversation_assignments" a
       JOIN "conversations" c ON c."id" = a."conversation_id"
       LEFT JOIN "workspace_members" m ON m."id" = a."assigned_to_id"
       LEFT JOIN "users" u ON u."id" = m."user_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "conversation_events"`);
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN "priority"`,
    );
    await queryRunner.query(`DROP TYPE "public"."conversations_priority_enum"`);
  }
}
