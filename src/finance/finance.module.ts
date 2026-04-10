import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, GoogleSheetsModule, AuthModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
