import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import databaseConfig, { DatabaseConfig } from './config/database.config';
import jwtConfig from './config/jwt.config';
import { User } from './database/models/user.model';
import { RefreshToken } from './database/models/refresh-token.model';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './health/health.controller';
import { AppLoggerService } from './logger/logger.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
    }),
    SequelizeModule.forRootAsync({
      imports: [ConfigModule.forFeature(databaseConfig)],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const db = configService.get<DatabaseConfig>('database')!;
        const appLogger = new AppLoggerService();
        return {
          dialect: 'postgres',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          models: [User, RefreshToken],
          autoLoadModels: false,
          logging: db.logging
            ? (msg: string) => appLogger.debug(msg, 'Sequelize')
            : false,
          dialectOptions: db.ssl
            ? {
                ssl: {
                  require: true,
                  rejectUnauthorized: db.sslRejectUnauthorized,
                },
              }
            : {},
        };
      },
    }),
    AuthModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [AppLoggerService],
})
export class AppModule {}
