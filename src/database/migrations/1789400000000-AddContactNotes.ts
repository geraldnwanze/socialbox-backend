import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContactNotes1789400000000 implements MigrationInterface {
  name = 'AddContactNotes1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contacts" ADD "notes" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "notes"`);
  }
}
