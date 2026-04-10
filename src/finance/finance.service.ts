import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { FinanceRecord } from '../common/types/finance.types';
import { SHEET_CONSTANTS } from '../common/constants/sheets.constants';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(private googleSheetsService: GoogleSheetsService) {}


  async addFinanceRecord(record: Omit<FinanceRecord, 'id'>): Promise<void> {
    try {
      const sheetName = this.getSheetNameFromDate(record.date);
  
      if (record.type === 'expense') {
        const rowData = [
          record.date,
          record.amount.toString(),
          record.category,
          record.description || '',
        ];
        await this.googleSheetsService.addExpenseRow(sheetName, rowData);
  
      } else {
        const rowData = [
          record.date,
          record.amount.toString(),
          record.category,
          record.description || '',
        ];
        await this.googleSheetsService.addIncomeRow(sheetName, rowData);
      }
  
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Xatolik: ${message}`);
      throw new BadRequestException('Finance record qo\'shishda xatolik');
    }
  }

  async getSvodkaReport() {
    const sheet = SHEET_CONSTANTS.SVODKA_SHEET_NAME;
    const ranges = [
      `${sheet}!${SHEET_CONSTANTS.RANGES.SVODKA.CURRENT_MONTH}`,
      `${sheet}!${SHEET_CONSTANTS.RANGES.SVODKA.INITIAL_AMOUNT}`,
      `${sheet}!${SHEET_CONSTANTS.RANGES.SVODKA.EXPENSE_CATEGORIES}`,
      `${sheet}!${SHEET_CONSTANTS.RANGES.SVODKA.INCOME_CATEGORIES}`,
    ];

    const data = await this.googleSheetsService.getBatchData(ranges);
    
    return {
      currentMonth: data[0]?.[0]?.[0],
      savings: data[1]?.[0]?.[0],
      expenses: data[2],
      income: data[3]
    };
  }


  async getCurrentMonthRecords(): Promise<FinanceRecord[]> {
    try {
      const sheetName = this.googleSheetsService.getCurrentMonthSheetName();
      return await this.googleSheetsService.getFinanceRecords(sheetName);
    } catch (error: any) {
      this.logger.error(
        `Error fetching current month records: ${error.message}`,
      );
      throw new BadRequestException('Failed to fetch records');
    }
  }

  async getMonthRecords(year: number, month: number): Promise<FinanceRecord[]> {
    try {
      const sheetName = this.googleSheetsService.getSheetName(year, month);
      return await this.googleSheetsService.getFinanceRecords(sheetName);
    } catch (error: any) {
      this.logger.error(`Error fetching month records: ${error.message}`);
      throw new BadRequestException('Failed to fetch month records');
    }
  }

  async getFilteredRecords(
    year?: number,
    month?: number,
  ): Promise<FinanceRecord[]> {
    try {
      if (year && month) {
        const sheetName = this.googleSheetsService.getSheetName(year, month);
        return await this.googleSheetsService.getFinanceRecords(sheetName);
      }
      if (year && !month) {
        return await this.getYearRecords(year);
      }
      const sheetName = this.googleSheetsService.getCurrentMonthSheetName();
      return await this.googleSheetsService.getFinanceRecords(sheetName);
    } catch (error: any) {
      this.logger.error(`Error fetching filtered records: ${error.message}`);
      throw new BadRequestException('Failed to fetch filtered records');
    }
  }

  private async getYearRecords(year: number): Promise<FinanceRecord[]> {
    const sheetPromises: Promise<FinanceRecord[]>[] = [];
    
    for (let month = 1; month <= 12; month++) {
      const sheetName = this.googleSheetsService.getSheetName(year, month);
      const promise = this.googleSheetsService.getFinanceRecords(sheetName)
        .catch(() => {
          this.logger.warn(`Sheet "${sheetName}" not found for ${year}-${month}`);
          return [] as FinanceRecord[];
        });
      sheetPromises.push(promise);
    }
    
    const results = await Promise.all(sheetPromises);
    return results.flat();
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────────────

  /**
   * @param id  - "expense-row-5" yoki "income-row-7" formatida
   * @param record - O'zgartiriladigan maydonlar (partial)
   * @param year  - Sheet yili (default: joriy yil)
   * @param month - Sheet oyi (default: joriy oy)
   */
  async updateFinanceRecord(
    id: string,
    record: Partial<FinanceRecord>,
    year?: number,
    month?: number,
  ): Promise<void> {
    try {
      // 1. id ni parse qilish: "expense-row-5" → type="expense", rowIndex=5
      const match = id.match(/^(income|expense)-row-(\d+)$/);
      if (!match) {
        throw new BadRequestException(`Noto'g'ri id format: "${id}"`);
      }
      const type = match[1] as 'income' | 'expense';
      const rowIndex = Number(match[2]);

      const y = year ?? new Date().getFullYear();
      const m = month ?? new Date().getMonth() + 1;
      const sheetName = this.googleSheetsService.getSheetName(y, m);

      const records =
        await this.googleSheetsService.getFinanceRecords(sheetName);
      const existing = records.find((r) => r.id === id);
      if (!existing) {
        throw new NotFoundException(`Record "${id}" topilmadi`);
      }

      const rowData = [
        record.date ?? existing.date,
        String(record.amount ?? existing.amount),
        record.description ?? existing.description,
        record.category ?? existing.category,
      ];

      await this.googleSheetsService.updateRow(
        sheetName,
        rowIndex,
        rowData,
        type,
      );
      this.logger.log(`Updated "${id}" in sheet "${sheetName}"`);
    } catch (error: any) {
      this.logger.error(`Error updating finance record: ${error.message}`);
      if (error instanceof NotFoundException) throw error;
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to update finance record');
    }
  }


  /**
   * @param id    - "expense-row-5" yoki "income-row-7"
   * @param year  - Sheet yili (default: joriy yil)
   * @param month - Sheet oyi (default: joriy oy)
   */
  async deleteFinanceRecord(
    id: string,
    year?: number,
    month?: number,
  ): Promise<void> {
    try {
      const match = id.match(/^(income|expense)-row-(\d+)$/);
      if (!match) {
        throw new BadRequestException(`Noto'g'ri id format: "${id}"`);
      }
      const rowIndex = Number(match[2]);

      const y = year ?? new Date().getFullYear();
      const m = month ?? new Date().getMonth() + 1;
      const sheetName = this.googleSheetsService.getSheetName(y, m);

      await this.googleSheetsService.deleteRow(sheetName, rowIndex);
      this.logger.log(`Deleted "${id}" from sheet "${sheetName}"`);
    } catch (error: any) {
      this.logger.error(`Error deleting finance record: ${error.message}`);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to delete finance record');
    }
  }


  async calculateBalance(
    year?: number,
    month?: number,
  ): Promise<{
    totalIncome: number;
    totalExpense: number;
    balance: number;
  }> {
    try {
      const y = year ?? new Date().getFullYear();
      const m = month ?? new Date().getMonth() + 1;
  
      const svodkaSheet = 'Сводка';
  
      const [expenseResp, incomeResp, balanceResp] = await Promise.all([
        this.googleSheetsService.sheets.spreadsheets.values.get({
          spreadsheetId: this.googleSheetsService.spreadsheetId,
          range: `${svodkaSheet}!C24`,
        }),
        this.googleSheetsService.sheets.spreadsheets.values.get({
          spreadsheetId: this.googleSheetsService.spreadsheetId,
          range: `${svodkaSheet}!I24`,
        }),
        this.googleSheetsService.sheets.spreadsheets.values.get({
          spreadsheetId: this.googleSheetsService.spreadsheetId,
          range: `${svodkaSheet}!E15`, 
        }),
      ]);
  
      const rawExpense = expenseResp.data.values?.[0]?.[0] ?? '0';
      const rawIncome  = incomeResp.data.values?.[0]?.[0]  ?? '0';
      const rawBalance = balanceResp.data.values?.[0]?.[0] ?? '0';
  
      const totalExpense = parseFloat(String(rawExpense).replace(/[^\d.-]/g, '')) || 0;
      const totalIncome  = parseFloat(String(rawIncome).replace(/[^\d.-]/g, ''))  || 0;
      const balance      = parseFloat(String(rawBalance).replace(/[^\d.-]/g, '')) || 0;
      // const balance = totalIncome - totalExpense;
      
  
      this.logger.log(
        `Balance from Сводка: income=${totalIncome}, expense=${totalExpense}, balance=${balance}`,
      );
  
      return { totalIncome, totalExpense, balance };
    } catch (error: any) {
      this.logger.error(`Error calculating balance: ${error.message}`);
      throw new BadRequestException('Failed to calculate balance');
    }
  }


  async getCategories() {
    try {
      return await this.googleSheetsService.getCategories();
    } catch (error: any) {
      this.logger.error(`Error fetching categories: ${error.message}`);
      throw new BadRequestException('Failed to fetch categories');
    }
  }


  private getSheetNameFromDate(date: string): string {
    let year: number;
    let month: number;

    try {
      if (date.includes('-') && date.indexOf('-') === 4) {
        // YYYY-MM-DD
        const parts = date.split('-');
        year = parseInt(parts[0]);
        month = parseInt(parts[1]);
      } else if (date.includes('.')) {
        // DD.MM.YYYY
        const parts = date.split('.');
        year = parseInt(parts[2]);
        month = parseInt(parts[1]);
      } else {
        return this.googleSheetsService.getCurrentMonthSheetName();
      }

      // Validate parsed values
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        this.logger.warn(`Invalid date format: ${date}, using current month`);
        return this.googleSheetsService.getCurrentMonthSheetName();
      }

      return this.googleSheetsService.getSheetName(year, month);
    } catch (error) {
      this.logger.error(`Error parsing date "${date}": ${error instanceof Error ? error.message : String(error)}`);
      return this.googleSheetsService.getCurrentMonthSheetName();
    }
  }

  async getInitialAmounts() {
    try {
      return await this.googleSheetsService.getInitialAmounts();
    } catch (error: any) {
      this.logger.error(`Error fetching initial amounts: ${error.message}`);
      throw new BadRequestException('Failed to fetch initial amounts');
    }
  }
  
  async updateInitialAmount(rowIndex: number, amount: number) {
    try {
      return await this.googleSheetsService.updateInitialAmount(rowIndex, amount);
    } catch (error: any) {
      this.logger.error(`Error updating initial amount: ${error.message}`);
      throw new BadRequestException('Failed to update initial amount');
    }
  }


  async getAvailableSheets(): Promise<{ sheets: { name: string; month: number; year: number }[] }> {
    try {
      // F2 dagi Data Validation ro'yxatini olish
      const validationRes = await this.googleSheetsService.sheets.spreadsheets.get({
        spreadsheetId: this.googleSheetsService.spreadsheetId,
        ranges: ['Сводка!F2'],
        includeGridData: true,
      });
  
      const cellData = validationRes.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0];
      const validation = cellData?.dataValidation?.condition;
  
      let sheetNames: string[] = [];
  
      if (validation?.type === 'ONE_OF_LIST') {
        // Dropdown qiymatlari to'g'ridan-to'g'ri ro'yxatda
        sheetNames = validation.values?.map((v) => v.userEnteredValue || '').filter(Boolean) ?? [];
      } else if (validation?.type === 'ONE_OF_RANGE') {
        // Dropdown boshqa rangega (masalan =Kategoriyalar!A1:A12) havola qilgan bo'lsa
        const rangeRef = validation.values?.[0]?.userEnteredValue || '';
        if (rangeRef) {
          const rangeRes = await this.googleSheetsService.sheets.spreadsheets.values.get({
            spreadsheetId: this.googleSheetsService.spreadsheetId,
            range: rangeRef.replace(/^=/, ''),
          });
          sheetNames = (rangeRes.data.values || []).flat().filter(Boolean);
        }
      }
  
      const UZ_MONTHS: Record<string, number> = {
        Yanvar: 1, Fevral: 2, Mart: 3, Aprel: 4,
        May: 5, Iyun: 6, Iyul: 7, Avgust: 8,
        Sentabr: 9, Oktabr: 10, Noyabr: 11, Dekabr: 12,
      };
  
      const currentYear = new Date().getFullYear();
  
      const sheets = sheetNames
        .map((name) => {
          const parts = name.trim().split(' ');
          const monthName = parts[0];
          const year = parts[1] ? parseInt(parts[1]) : currentYear;
          const month = UZ_MONTHS[monthName] ?? null;
          return { name, month, year };
        })
        .filter((s) => s.month !== null)
        .sort((a, b) => a.year !== b.year ? a.year - b.year : (a.month ?? 0) - (b.month ?? 0));
  
      return { sheets } as any;
    } catch (error: any) {
      this.logger.error(`Error fetching available sheets: ${error.message}`);
      throw new BadRequestException('Failed to fetch available sheets');
    }
  }


  async setActiveSheet(sheetName: string): Promise<{ success: boolean; sheetName: string }> {
    try {
      await this.googleSheetsService.sheets.spreadsheets.values.update({
        spreadsheetId: this.googleSheetsService.spreadsheetId,
        range: 'Сводка!F2',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[sheetName]],
        },
      });
  
      this.logger.log(`Active sheet changed to: ${sheetName}`);
      return { success: true, sheetName };
    } catch (error: any) {
      this.logger.error(`Error setting active sheet: ${error.message}`);
      throw new BadRequestException('Failed to set active sheet');
    }
  }

  async getActiveSheet(): Promise<{ name: string; month: number; year: number }> {
    try {
      const res = await this.googleSheetsService.sheets.spreadsheets.values.get({
        spreadsheetId: this.googleSheetsService.spreadsheetId,
        range: 'Сводка!F2',
      });
  
      const name = res.data.values?.[0]?.[0] ?? '';
  
      const UZ_MONTHS: Record<string, number> = {
        Yanvar: 1, Fevral: 2, Mart: 3, Aprel: 4,
        May: 5, Iyun: 6, Iyul: 7, Avgust: 8,
        Sentabr: 9, Oktabr: 10, Noyabr: 11, Dekabr: 12,
      };
  
      const parts = name.trim().split(' ');
      const month = UZ_MONTHS[parts[0]] ?? new Date().getMonth() + 1;
      const year = parts[1] ? parseInt(parts[1]) : new Date().getFullYear();
  
      return { name, month, year };
    } catch (error: any) {
      this.logger.error(`Error fetching active sheet: ${error.message}`);
      throw new BadRequestException('Failed to fetch active sheet');
    }
  }
}
