import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token issued during login/refresh',
  })
  @IsString()
  @IsJWT()
  refreshToken!: string;
}
