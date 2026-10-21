import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

@Module({})
export class DatabaseModule {
  /**
   * `runMigrations` should be true for exactly one process (the API). If the worker also ran
   * them, both would race to create the same schema on a fresh database.
   */
  static forRoot(options: { runMigrations: boolean }): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            type: 'postgres',
            url: configService.get<string>('database.url'),
            namingStrategy: new SnakeNamingStrategy(),
            autoLoadEntities: true,
            // Schema changes only ever come from migrations — synchronize is never safe
            // once real data exists.
            synchronize: false,
            // Resolves to src/ under ts-node and dist/ in the production image.
            migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
            migrationsRun: options.runMigrations,
            logging:
              configService.get<string>('nodeEnv') === 'development'
                ? ['warn', 'error']
                : ['error'],
          }),
        }),
      ],
    };
  }
}
