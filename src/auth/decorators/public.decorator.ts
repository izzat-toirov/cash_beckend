// src/auth/decorators/public.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * @Public() — bu route JWT guard'dan ozod
 *
 * Usage:
 *   @Public()
 *   @Get('health')
 *   healthCheck() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);