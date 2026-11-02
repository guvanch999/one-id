import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiProperty({
    required: false,
    description:
      'Optional refresh token. If provided, only that session is revoked; ' +
      'otherwise all refresh tokens of the user are revoked.',
  })
  @IsOptional()
  @IsString()
  @IsJWT()
  refreshToken?: string;
}
