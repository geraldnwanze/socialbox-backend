import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('database.url'),
        namingStrategy: new SnakeNamingStrategy(),
        autoLoadEntities: true,
        // Migrations only, ever — synchronize is never safe once real data exists.
        synchronize: false,
        logging:
          configService.get<string>('nodeEnv') === 'development'
            ? ['warn', 'error']
            : ['error'],
      }),
    }),
  ],
})
export class DatabaseModule {}
