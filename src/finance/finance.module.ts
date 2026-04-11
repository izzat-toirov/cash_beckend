// src/finance/finance.module.ts

import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';

@Module({
  imports: [GoogleSheetsModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}