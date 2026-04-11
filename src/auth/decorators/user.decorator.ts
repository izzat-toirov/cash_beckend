// src/auth/decorators/user.decorator.ts

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../types/auth.types';

/**
 * @User() decorator — JWT token'dan user ma'lumotlarini oladi
 *
 * Usage:
 *   @Get()
 *   async getData(@User() user: JwtPayload) {
 *     console.log(user.sheetId); // user'ning Google Sheet ID si
 *   }
 */
export const User = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | any => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    // @User('sheetId') — faqat bitta field olish
    if (data) {
      return user?.[data];
    }

    return user;
  },
);