import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.getOrThrow('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile', `https://www.googleapis.com/auth/drive`],
    });
  }

  async validate(
    accessToken: string, // ← endi ishlatiladi
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const user = await this.authService.handleGoogleLogin({
        googleId: profile.id,
        email: profile.emails![0].value,
        displayName: profile.displayName,
        accessToken, // ← qo'shildi
      });
      done(null, user);
    } catch (err) {
      done(err, undefined);
    }
  }
}