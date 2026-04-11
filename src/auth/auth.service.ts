// src/auth/auth.service.ts

import {
  Injectable,
  Logger,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import {
  GoogleProfile,
  AuthenticatedUser,
  JwtPayload,
} from './types/auth.types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly sheetsService: GoogleSheetsService,
  ) {}

  async handleGoogleLogin(profile: GoogleProfile): Promise<AuthenticatedUser> {
    try {
      // 1. Email conflict tekshirish
      const emailConflict = await this.prisma.user.findUnique({
        where: { email: profile.email },
      });

      if (emailConflict && emailConflict.googleId !== profile.googleId) {
        throw new ConflictException(
          `Bu email allaqachon boshqa hisob bilan bog'langan: ${profile.email}`,
        );
      }

      // 2. Mavjud user qidirish
      const existing = await this.prisma.user.findUnique({
        where: { googleId: profile.googleId },
      });

      let sheetId: string;

      if (existing) {
        // ✅ Qaytuvchi user — mavjud sheetId ishlatiladi
        this.logger.log(`Qaytuvchi user: ${profile.email}`);
        sheetId = existing.sheetId;
      } else {
        // ✅ Yangi user — template nusxalanadi, yangi sheet yaratiladi
        this.logger.log(`Yangi user, sheet yaratilmoqda: ${profile.email}`);

        try {
          sheetId = await this.sheetsService.copyTemplateForUser(
            profile.email,
            profile.displayName,
            profile.accessToken,
          );
        } catch (sheetError: unknown) {
          const message =
            sheetError instanceof Error ? sheetError.message : String(sheetError);
          this.logger.error(
            `Sheet yaratishda xatolik [${profile.email}]: ${message}`,
          );
          throw new InternalServerErrorException(
            "Google Sheet yaratishda xatolik yuz berdi. Qaytadan urinib ko'ring.",
          );
        }

        this.logger.log(`✅ Sheet yaratildi: ${sheetId} → ${profile.email}`);
      }

      // 3. DB upsert
      const user = await this.prisma.user.upsert({
        where: { googleId: profile.googleId },
        update: {
          displayName: profile.displayName,
          email: profile.email,
          lastLoginAt: new Date(),
        },
        create: {
          googleId: profile.googleId,
          email: profile.email,
          displayName: profile.displayName,
          sheetId,
          lastLoginAt: new Date(),
        },
      });

      this.logger.log(`✅ Login muvaffaqiyatli: ${user.email}`);

      return {
        googleId: user.googleId,
        email: user.email,
        displayName: user.displayName,
        sheetId: user.sheetId,
      };
    } catch (error: unknown) {
      if (
        error instanceof ConflictException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `handleGoogleLogin umumiy xatolik [${profile.email}]: ${message}`,
      );
      throw new InternalServerErrorException(
        'Login jarayonida xatolik yuz berdi.',
      );
    }
  }

  signJwt(user: AuthenticatedUser): string {
    const payload: JwtPayload = {
      sub: user.googleId,
      email: user.email,
      sheetId: user.sheetId,        // ✅ sheetId token ichiga kiritiladi
      displayName: user.displayName,
    };

    return this.jwtService.sign(payload);
  }
}