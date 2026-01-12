import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService, AuthTokens } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register user' })
  @ApiCreatedResponse({ description: 'User registered with tokens' })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @ApiConflictResponse({ description: 'User already exists' })
  async register(@Body() payload: RegisterDto): Promise<AuthTokens> {
    return this.authService.register(payload);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiOkResponse({ description: 'Login success, returns tokens' })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(@Body() payload: LoginDto): Promise<AuthTokens> {
    return this.authService.login(payload);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiOkResponse({ description: 'Tokens refreshed' })
  @ApiUnauthorizedResponse({ description: 'Refresh token invalid or revoked' })
  @ApiBearerAuth('access-token')
  async refresh(@Body() payload: RefreshTokenDto): Promise<AuthTokens> {
    return this.authService.refresh(payload);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout user and revoke refresh tokens' })
  @ApiNoContentResponse({ description: 'Logged out' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request & { user?: { id: string } },
    @Body() payload: LogoutDto,
  ): Promise<void> {
    if (!req.user?.id) {
      throw new Error('User context missing in request');
    }
    await this.authService.logout(req.user.id, payload);
  }
}
