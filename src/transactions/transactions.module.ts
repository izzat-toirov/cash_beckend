import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GoogleSheetsModule, AuthModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
