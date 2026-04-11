// src/finance/finance.service.ts

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import {
  CreateFinanceRecordDto,
  UpdateFinanceRecordDto,
} from './dto/finance-record.dto';
import { FinanceRecord } from '../common/types/finance.types';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(private readonly sheetsService: GoogleSheetsService) {}

  // ─── Yozuv qo'shish ────────────────────────────────────────────────────────

  async addFinanceRecord(
    spreadsheetId: string,
    dto: CreateFinanceRecordDto,
  ): Promise<void> {
    const sheetName = this.resolveSheetName(dto.date);

    // Kategoriya validatsiya
    const validation = await this.sheetsService.validateCategoryStrict(
      spreadsheetId,
      dto.category,
      dto.type,
    );

    if (!validation.isValid) {
      throw new BadRequestException(
        `Kategoriya topilmadi: "${dto.category}". /finance/categories dan to'g'ri kategoriyani tanlang.`,
      );
    }

    const normalizedCategory = validation.normalized ?? dto.category;

    await this.sheetsService.addRow(spreadsheetId, sheetName, [
      dto.date,
      '',
      String(dto.amount),
      normalizedCategory,
      dto.description || '',
      dto.type,
    ]);

    this.logger.log(
      `✅ Yozuv qo'shildi [${spreadsheetId}]: ${dto.type} ${dto.amount} — ${normalizedCategory}`,
    );
  }

  // ─── Joriy oy yozuvlari ────────────────────────────────────────────────────

  async getCurrentMonthRecords(
    spreadsheetId: string,
  ): Promise<{ success: boolean; data: FinanceRecord[] }> {
    const sheetName = this.sheetsService.getCurrentMonthSheetName();
    const data = await this.sheetsService.getFinanceRecords(
      spreadsheetId,
      sheetName,
    );
    return { success: true, data };
  }

  // ─── Balans hisoblash ─────────────────────────────────────────────────────

  async calculateBalance(
    spreadsheetId: string,
    year?: number,
    month?: number,
  ): Promise<{ totalIncome: number; totalExpense: number; balance: number }> {
    const now = new Date();
    const y = year ?? now.getFullYear();
    const m = month ?? now.getMonth() + 1;
    const sheetName = this.sheetsService.getSheetName(y, m);

    const records = await this.sheetsService.getFinanceRecords(
      spreadsheetId,
      sheetName,
    );

    const totalIncome = records
      .filter((r) => r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0);

    const totalExpense = records
      .filter((r) => r.type === 'expense')
      .reduce((sum, r) => sum + r.amount, 0);

    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
    };
  }

  // ─── Kategoriyalar ─────────────────────────────────────────────────────────

  async getCategories(
    spreadsheetId: string,
  ): Promise<{ name: string; type: string }[]> {
    return this.sheetsService.getCategories(spreadsheetId);
  }

  // ─── Filter bo'yicha yozuvlar ──────────────────────────────────────────────

  async getFilteredRecords(
    spreadsheetId: string,
    year?: number,
    month?: number,
  ): Promise<{ success: boolean; data: FinanceRecord[]; meta: object }> {
    const now = new Date();

    if (year && month) {
      const sheetName = this.sheetsService.getSheetName(year, month);
      const data = await this.sheetsService.getFinanceRecords(
        spreadsheetId,
        sheetName,
      );
      return {
        success: true,
        data,
        meta: { year, month, sheetName },
      };
    }

    if (year && !month) {
      // Butun yil — barcha 12 oy
      const allRecords: FinanceRecord[] = [];
      for (let m = 1; m <= 12; m++) {
        const sheetName = this.sheetsService.getSheetName(year, m);
        try {
          const records = await this.sheetsService.getFinanceRecords(
            spreadsheetId,
            sheetName,
          );
          allRecords.push(...records);
        } catch {
          // Sheet mavjud bo'lmasa — o'tkazib yuborish
        }
      }
      return {
        success: true,
        data: allRecords,
        meta: { year, sheetName: 'all-months' },
      };
    }

    // Default — joriy oy
    const sheetName = this.sheetsService.getCurrentMonthSheetName();
    const data = await this.sheetsService.getFinanceRecords(
      spreadsheetId,
      sheetName,
    );
    return {
      success: true,
      data,
      meta: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        sheetName,
      },
    };
  }

  // ─── Aniq bir oy ──────────────────────────────────────────────────────────

  async getMonthRecords(
    spreadsheetId: string,
    year: number,
    month: number,
  ): Promise<{ success: boolean; data: FinanceRecord[]; meta: object }> {
    if (!year || !month || month < 1 || month > 12) {
      throw new BadRequestException(
        "Noto'g'ri yil yoki oy. Oy 1–12 oralig'ida bo'lishi kerak.",
      );
    }

    const sheetName = this.sheetsService.getSheetName(year, month);
    const data = await this.sheetsService.getFinanceRecords(
      spreadsheetId,
      sheetName,
    );

    return {
      success: true,
      data,
      meta: { year, month, sheetName },
    };
  }

  // ─── Yangilash ────────────────────────────────────────────────────────────

  async updateFinanceRecord(
    spreadsheetId: string,
    id: string,
    dto: UpdateFinanceRecordDto,
    year?: number,
    month?: number,
  ): Promise<void> {
    const parsed = this.parseRecordId(id);
    const sheetName = this.resolveSheetNameByParams(year, month);

    const rowData = [
      dto.date ?? '',
      String(dto.amount ?? 0),
      dto.category ?? '',
      dto.description ?? '',
    ];

    await this.sheetsService.updateRow(
      spreadsheetId,
      sheetName,
      parsed.rowIndex,
      rowData,
      parsed.type,
    );

    this.logger.log(`✅ Yangilandi [${spreadsheetId}]: ${id}`);
  }

  // ─── O'chirish ────────────────────────────────────────────────────────────

  async deleteFinanceRecord(
    spreadsheetId: string,
    id: string,
    year?: number,
    month?: number,
  ): Promise<void> {
    const parsed = this.parseRecordId(id);
    const sheetName = this.resolveSheetNameByParams(year, month);

    await this.sheetsService.deleteRow(
      spreadsheetId,
      sheetName,
      parsed.rowIndex,
    );

    this.logger.log(`✅ O'chirildi [${spreadsheetId}]: ${id}`);
  }

  // ─── Initial amounts ───────────────────────────────────────────────────────

  async getInitialAmounts(spreadsheetId: string) {
    return this.sheetsService.getInitialAmounts(spreadsheetId);
  }

  async updateInitialAmount(
    spreadsheetId: string,
    rowIndex: number,
    amount: number,
  ) {
    return this.sheetsService.updateInitialAmount(spreadsheetId, rowIndex, amount);
  }

  // ─── Sheet management ──────────────────────────────────────────────────────

  async getAvailableSheets(spreadsheetId: string) {
    return this.sheetsService.getAvailableSheets(spreadsheetId);
  }

  async getActiveSheet(spreadsheetId: string) {
    return this.sheetsService.getActiveSheet(spreadsheetId);
  }

  async setActiveSheet(spreadsheetId: string, sheetName: string) {
    return this.sheetsService.setActiveSheet(spreadsheetId, sheetName);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private resolveSheetName(date: string): string {
    try {
      const d = new Date(date);
      return this.sheetsService.getSheetName(
        d.getFullYear(),
        d.getMonth() + 1,
      );
    } catch {
      return this.sheetsService.getCurrentMonthSheetName();
    }
  }

  private resolveSheetNameByParams(year?: number, month?: number): string {
    if (year && month) {
      return this.sheetsService.getSheetName(year, month);
    }
    return this.sheetsService.getCurrentMonthSheetName();
  }

  private parseRecordId(id: string): {
    type: 'income' | 'expense';
    rowIndex: number;
  } {
    // Format: "expense-row-5" yoki "income-row-7"
    const match = id.match(/^(income|expense)-row-(\d+)$/);
    if (!match) {
      throw new BadRequestException(
        `Noto'g'ri id format: "${id}". To'g'ri format: "expense-row-5" yoki "income-row-7"`,
      );
    }
    return {
      type: match[1] as 'income' | 'expense',
      rowIndex: parseInt(match[2], 10),
    };
  }
}