import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiProperty({
    required: false,
    description:
      'Опциональный refresh token. Если не передан — инвалидируются все токены пользователя.',
  })
  @IsOptional()
  @IsString()
  @IsJWT()
  refreshToken?: string;
}
