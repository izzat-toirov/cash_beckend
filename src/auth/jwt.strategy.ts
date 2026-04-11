// src/auth/strategies/jwt.strategy.ts

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './types/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Token ichidagi sheetId'ni DB dan tekshirish (optional lekin xavfsiz)
    const user = await this.prisma.user.findUnique({
      where: { googleId: payload.sub },
      select: { googleId: true, email: true, sheetId: true, displayName: true },
    });

    if (!user) {
      throw new UnauthorizedException('Foydalanuvchi topilmadi');
    }

    // request.user ga inject bo'ladi
    return {
      sub: user.googleId,
      email: user.email,
      sheetId: user.sheetId,
      displayName: user.displayName,
    };
  }
}