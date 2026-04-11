import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import  type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './types/auth.types';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name)
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // ── API key tekshiruvi (oldingi) ──────────────────────────
  // Faqat shu endpoint ApiKeyGuard ostida qoladi
  @Get('verify')
  @UseGuards(ApiKeyGuard)
  @ApiHeader({
    name: 'x-api-key',
    description: 'API kalit',
    required: true,
  })
  @ApiBearerAuth('x-api-key')
  @ApiOperation({ summary: 'API kalitni tekshirish' })
  @ApiResponse({ status: 200, description: 'Autentifikatsiya muvaffaqiyatli' })
  @ApiResponse({ status: 401, description: "Noto'g'ri kalit" })
  verifyApiKey() {
    return { authenticated: true };
  }

  // ── Google OAuth ──────────────────────────────────────────
  // Guard yo'q — foydalanuvchi hali login qilmagan
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth login boshlash' })
  @ApiResponse({ status: 302, description: 'Google consent screen\'ga redirect' })
  googleLogin() {
    // Passport o'zi redirect qiladi
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback' })
  @ApiResponse({ status: 302, description: 'Frontendga token bilan redirect' })
  googleCallback(@Req() req: RequestWithUser, @Res() res: Response) {
    const token = this.authService.signJwt(req.user);
    const frontendUrl = this.configService.getOrThrow('FRONTEND_URL');
    const redirectUrl = `${frontendUrl}/auth/callback?token=${token}`;
    this.logger.log(`Redirecting to: ${redirectUrl.substring(0, 80)}...`);
    res.redirect(redirectUrl);
  }

  // ── JWT bilan himoyalangan ────────────────────────────────
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Joriy foydalanuvchi ma\'lumotlari' })
  @ApiResponse({ status: 200, description: 'Foydalanuvchi' })
  @ApiResponse({ status: 401, description: 'Token yaroqsiz' })
  getMe(@Req() req: RequestWithUser) {
    return {
      email: req.user.email,
      displayName: req.user.displayName,
      sheetId: req.user.sheetId,
    };
  }

  @Post('logout')
@HttpCode(HttpStatus.OK)
logout(@Res({ passthrough: true }) res: Response) {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });

  return { success: true, message: "Muvaffaqiyatli chiqildi" };
}
}