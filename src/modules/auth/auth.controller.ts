import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService, AuthTokens } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestWithContext } from '../../common/types/request-context';

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
  @ApiForbiddenResponse({ description: 'User account is blocked' })
  async login(@Body() payload: LoginDto): Promise<AuthTokens> {
    return this.authService.login(payload);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate refresh token',
    description:
      'Revokes the presented refresh token and returns a new token pair. ' +
      'Re-using an already rotated token revokes all sessions of the user.',
  })
  @ApiOkResponse({ description: 'Tokens refreshed' })
  @ApiUnauthorizedResponse({
    description: 'Refresh token invalid, expired, revoked or reused',
  })
  @ApiForbiddenResponse({ description: 'User account is blocked' })
  async refresh(@Body() payload: RefreshTokenDto): Promise<AuthTokens> {
    return this.authService.refresh(payload);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout user and revoke refresh tokens' })
  @ApiNoContentResponse({ description: 'Logged out' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: RequestWithContext,
    @Body() payload: LogoutDto,
  ): Promise<void> {
    if (!req.user?.id) {
      throw new UnauthorizedException();
    }
    await this.authService.logout(req.user.id, payload);
  }
}
