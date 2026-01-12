import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { RefreshToken } from '../../database/models/refresh-token.model';
import { JwtStrategy } from './strategies/jwt.strategy';
import jwtConfig, { JwtConfig } from '../../config/jwt.config';
import { AppLoggerService } from '../../logger/logger.service';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule.forFeature(jwtConfig)],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<JwtConfig>('jwt')!;
        return {
          secret: config.accessSecret,
          signOptions: {
            expiresIn: config.accessTokenTtl,
            issuer: config.issuer,
            audience: config.audience,
          },
        };
      },
    }),
    SequelizeModule.forFeature([RefreshToken]),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AppLoggerService],
})
export class AuthModule {}
