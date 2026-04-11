import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import {
  FinanceRecord,
  SheetData,
  SvodkaData,
} from '../common/types/finance.types';
import { SHEET_CONSTANTS } from '../common/constants/sheets.constants';

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);

  // ✅ auth public — FinanceService ham ishlatishi uchun
  public readonly auth: any;

  private readonly MONTHS_UZ = [
    'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
    'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
  ];

  constructor(private configService: ConfigService) {
    const privateKey = this.configService.get<string>('GOOGLE_PRIVATE_KEY');
    if (!privateKey) {
      throw new Error('GOOGLE_PRIVATE_KEY is not configured');
    }

    this.auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        private_key: privateKey.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ],
    });
  }

  // ✅ Har doim yangi sheets instance — dynamic spreadsheetId uchun
  private getSheetsClient(): sheets_v4.Sheets {
    return google.sheets({ version: 'v4', auth: this.auth });
  }

  // ─── Sheet nomi yordamchilari ──────────────────────────────────────────────

  getCurrentMonthSheetName(): string {
    const now = new Date();
    return this.MONTHS_UZ[now.getMonth()];
  }

  getSheetName(year: number, month: number): string {
    return this.MONTHS_UZ[month - 1];
  }

  // ─── Asosiy CRUD metodlar (har biri spreadsheetId oladi) ──────────────────

  async getCellValue(
    spreadsheetId: string,
    sheetName: string,
    cell: string,
  ): Promise<number> {
    const sheets = this.getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${cell}`,
    });
    const raw = resp.data.values?.[0]?.[0] ?? '0';
    return parseFloat(String(raw).replace(/[^\d.-]/g, '')) || 0;
  }

  async addExpenseRow(
    spreadsheetId: string,
    sheetName: string,
    rowData: string[],
  ): Promise<void> {
    const sheets = this.getSheetsClient();
    try {
      await this.ensureSheetExists(spreadsheetId, sheetName);
      const nextRow = await this.getNextAvailableRow(spreadsheetId, sheetName, 'expense');

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!B${nextRow}:E${nextRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] },
      });

      this.logger.log(`✅ Xarajat ${nextRow}-qatorga yozildi: ${JSON.stringify(rowData)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`addExpenseRow xatolik: ${message}`);
      throw error;
    }
  }

  async addIncomeRow(
    spreadsheetId: string,
    sheetName: string,
    rowData: string[],
  ): Promise<void> {
    const sheets = this.getSheetsClient();
    try {
      await this.ensureSheetExists(spreadsheetId, sheetName);
      const nextRow = await this.getNextAvailableRow(spreadsheetId, sheetName, 'income');

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!G${nextRow}:J${nextRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] },
      });

      this.logger.log(`✅ Daromad ${nextRow}-qatorga yozildi: ${JSON.stringify(rowData)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`addIncomeRow xatolik: ${message}`);
      throw error;
    }
  }

  async addRow(
    spreadsheetId: string,
    sheetName: string,
    rowData: string[],
  ): Promise<void> {
    const type = rowData[rowData.length - 1];

    if (type === 'expense') {
      await this.addExpenseRow(spreadsheetId, sheetName, [
        rowData[0], // sana
        rowData[2], // summa
        rowData[3], // kategoriya
        rowData[4], // tavsif
      ]);
    } else if (type === 'income') {
      await this.addIncomeRow(spreadsheetId, sheetName, [
        rowData[0], // sana
        rowData[3], // tavsif
        rowData[4], // kategoriya
        rowData[2], // summa
      ]);
    } else {
      throw new Error(`Noto'g'ri type: "${type}"`);
    }
  }

  async getFinanceRecords(
    spreadsheetId: string,
    sheetName: string,
  ): Promise<FinanceRecord[]> {
    const sheets = this.getSheetsClient();
    const records: FinanceRecord[] = [];

    try {
      const expenseResp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!B5:E${SHEET_CONSTANTS.MAX_ROWS_PER_REQUEST}`,
      });

      (expenseResp.data.values || []).forEach((row, index) => {
        if (row[0] && row[1]) {
          records.push({
            id: `expense-row-${index + 5}`,
            date: row[0],
            amount: parseFloat(String(row[1]).replace(/[^\d.-]/g, '')) || 0,
            description: row[3] || '',
            category: row[2] || '',
            type: 'expense',
          });
        }
      });
    } catch (error: unknown) {
      this.logger.error(
        `Xarajat o'qishda xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const incomeResp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!G5:J${SHEET_CONSTANTS.MAX_ROWS_PER_REQUEST}`,
      });

      (incomeResp.data.values || []).forEach((row, index) => {
        if (row[0] && row[1]) {
          records.push({
            id: `income-row-${index + 5}`,
            date: row[0],
            amount: parseFloat(String(row[1]).replace(/[^\d.-]/g, '')) || 0,
            category: row[2] || '',
            description: row[3] || '',
            type: 'income',
          });
        }
      });
    } catch (error: unknown) {
      this.logger.error(
        `Daromad o'qishda xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return records;
  }

  async updateRow(
    spreadsheetId: string,
    sheetName: string,
    rowIndex: number,
    rowData: string[],
    type: 'income' | 'expense',
  ): Promise<void> {
    const sheets = this.getSheetsClient();
    try {
      await this.ensureSheetExists(spreadsheetId, sheetName);

      let range: string;
      let values: string[];

      if (type === 'expense') {
        range = `${sheetName}!B${rowIndex}:E${rowIndex}`;
        values = rowData;
      } else {
        range = `${sheetName}!G${rowIndex}:J${rowIndex}`;
        values = [rowData[0], rowData[3], rowData[2], rowData[1]];
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [values] },
      });

      this.logger.log(`✅ Yangilandi: ${range}`);
    } catch (error: unknown) {
      this.logger.error(
        `updateRow xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async deleteRow(
    spreadsheetId: string,
    sheetName: string,
    rowIndex: number,
  ): Promise<void> {
    const sheets = this.getSheetsClient();
    try {
      await this.ensureSheetExists(spreadsheetId, sheetName);
      const sheetId = await this.getSheetId(spreadsheetId, sheetName);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex: rowIndex - 1,
                  endIndex: rowIndex,
                },
              },
            },
          ],
        },
      });

      this.logger.log(`✅ O'chirildi: ${sheetName} qator ${rowIndex}`);
    } catch (error: unknown) {
      this.logger.error(
        `deleteRow xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ─── Kategoriyalar ─────────────────────────────────────────────────────────

  async getCategories(
    spreadsheetId: string,
  ): Promise<{ name: string; type: string }[]> {
    const sheets = this.getSheetsClient();
    try {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ['Сводка!B38:B1000', 'Сводка!H38:H1000'],
      });

      const vals = response.data.valueRanges || [];

      const expenses = (vals[0]?.values || [])
        .flat()
        .filter((c) => c && isNaN(Number(c)))
        .map((name) => ({ name, type: 'expense' }));

      const income = (vals[1]?.values || [])
        .flat()
        .filter((c) => c && isNaN(Number(c)))
        .map((name) => ({ name, type: 'income' }));

      return [...expenses, ...income];
    } catch (error: unknown) {
      this.logger.error(
        `getCategories xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async validateCategoryStrict(
    spreadsheetId: string,
    category: string,
    type: 'income' | 'expense',
  ): Promise<{ isValid: boolean; normalized?: string }> {
    const sheets = this.getSheetsClient();
    try {
      const range = type === 'expense' ? 'Сводка!B28:B45' : 'Сводка!H28:H45';
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      const validCategories = response.data.values?.flat().filter((c) => c) || [];
      const trimmed = category.trim();

      const exact = validCategories.find((c) => c === trimmed);
      if (exact) return { isValid: true, normalized: exact };

      const insensitive = validCategories.find(
        (c) => c.toLowerCase() === trimmed.toLowerCase(),
      );
      if (insensitive) {
        this.logger.warn(`⚠️ Case mismatch: "${trimmed}" -> "${insensitive}"`);
        return { isValid: true, normalized: insensitive };
      }

      return { isValid: false };
    } catch (error: unknown) {
      this.logger.error(
        `validateCategoryStrict xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { isValid: false };
    }
  }

  // ─── Сводка ────────────────────────────────────────────────────────────────

  async readSvodka(spreadsheetId: string): Promise<SvodkaData> {
    const sheets = this.getSheetsClient();
    try {
      const resp = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [
          'Сводка!D21',
          'Сводка!D22',
          'Сводка!J21',
          'Сводка!J22',
          'Сводка!B28:E45',
          'Сводка!H28:K45',
        ],
      });

      const vals = resp.data.valueRanges || [];
      const parseNum = (vr: sheets_v4.Schema$ValueRange) =>
        parseFloat(
          String(vr?.values?.[0]?.[0] || '0').replace(/[^\d.-]/g, ''),
        ) || 0;

      const expensePlanned = parseNum(vals[0]);
      const expenseActual = parseNum(vals[1]);
      const incomePlanned = parseNum(vals[2]);
      const incomeActual = parseNum(vals[3]);

      const expenseCategories = (vals[4]?.values || [])
        .filter((row: string[]) => row[0])
        .map((row: string[]) => ({
          category: row[0] || '',
          planned: parseFloat(String(row[1] || '0').replace(/[^\d.-]/g, '')) || 0,
          actual: parseFloat(String(row[2] || '0').replace(/[^\d.-]/g, '')) || 0,
          diff: parseFloat(String(row[3] || '0').replace(/[^\d.-]/g, '')) || 0,
        }));

      const incomeCategories = (vals[5]?.values || [])
        .filter((row: string[]) => row[0])
        .map((row: string[]) => ({
          category: row[0] || '',
          planned: parseFloat(String(row[1] || '0').replace(/[^\d.-]/g, '')) || 0,
          actual: parseFloat(String(row[2] || '0').replace(/[^\d.-]/g, '')) || 0,
          diff: parseFloat(String(row[3] || '0').replace(/[^\d.-]/g, '')) || 0,
        }));

      return {
        expensePlanned,
        expenseActual,
        incomePlanned,
        incomeActual,
        expenseCategories,
        incomeCategories,
      };
    } catch (error: unknown) {
      this.logger.error(
        `readSvodka xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ─── Initial amounts ───────────────────────────────────────────────────────

  async getInitialAmounts(spreadsheetId: string): Promise<{
    items: { label: string; amount: number }[];
    totalBalance: number;
    currentBalance: number;
  }> {
    const sheets = this.getSheetsClient();
    try {
      const [amountsResp, balanceResp, currentBalanceResp] = await Promise.all([
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'Сводка!C17:E21',
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'Сводка!F17',
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'Сводка!H17',
        }),
      ]);

      const parseSheetNumber = (str: string | undefined): number => {
        if (!str) return 0;
        return parseFloat(str.replace(/\s/g, '').replace(',', '.')) || 0;
      };

      const rows = amountsResp.data.values || [];
      const totalBalance = parseSheetNumber(
        String(balanceResp.data.values?.[0]?.[0] || ''),
      );
      const currentBalance = parseSheetNumber(
        String(currentBalanceResp.data.values?.[0]?.[0] || ''),
      );

      return {
        items: rows.map((row) => ({
          label: row[0] || '',
          amount: parseSheetNumber(row[2]),
        })),
        totalBalance,
        currentBalance,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`getInitialAmounts xatolik: ${message}`);
      throw error;
    }
  }

  async updateInitialAmount(
    spreadsheetId: string,
    rowIndex: number,
    amount: number,
  ): Promise<{ success: boolean; message: string; sheetRow: number; amount: number }> {
    const sheets = this.getSheetsClient();
    let sheetRow: number;

    if (rowIndex >= 17 && rowIndex <= 21) {
      sheetRow = rowIndex;
    } else if (rowIndex >= 0 && rowIndex <= 4) {
      sheetRow = 17 + rowIndex;
    } else {
      throw new BadRequestException("rowIndex 0–4 yoki 17–21 bo'lishi kerak");
    }

    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Сводка!E${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[amount.toString()]] },
      });

      this.logger.log(`✅ InitialAmount ${sheetRow}-qator yangilandi: ${amount}`);

      return {
        success: true,
        message: 'Summa muvaffaqiyatli yangilandi',
        sheetRow,
        amount,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`updateInitialAmount xatolik: ${message}`);
      throw error;
    }
  }

  // ─── Active sheet (Сводка F2) ──────────────────────────────────────────────

  async getAvailableSheets(spreadsheetId: string): Promise<{ sheets: string[] }> {
    const sheets = this.getSheetsClient();
    try {
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetNames = (spreadsheet.data.sheets || [])
        .map((s) => s.properties?.title || '')
        .filter(
          (name) =>
            name !== 'Сводка' &&
            name !== 'Categories' &&
            name !== '' &&
            this.MONTHS_UZ.includes(name),
        );
      return { sheets: sheetNames };
    } catch (error: unknown) {
      this.logger.error(
        `getAvailableSheets xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async getActiveSheet(spreadsheetId: string): Promise<{
    name: string;
    month: number;
    year: number;
  }> {
    const sheets = this.getSheetsClient();
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Сводка!F2',
      });

      const rawName = response.data.values?.[0]?.[0] || this.getCurrentMonthSheetName();
      const monthIndex = this.MONTHS_UZ.indexOf(rawName);
      const now = new Date();

      return {
        name: rawName,
        month: monthIndex >= 0 ? monthIndex + 1 : now.getMonth() + 1,
        year: now.getFullYear(),
      };
    } catch (error: unknown) {
      this.logger.error(
        `getActiveSheet xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async setActiveSheet(
    spreadsheetId: string,
    sheetName: string,
  ): Promise<{ success: boolean; message: string }> {
    const sheets = this.getSheetsClient();
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Сводка!F2',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[sheetName]] },
      });

      this.logger.log(`✅ Aktiv oy o'zgartirildi: ${sheetName}`);
      return { success: true, message: `Aktiv oy: ${sheetName}` };
    } catch (error: unknown) {
      this.logger.error(
        `setActiveSheet xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ─── Batch / utility ───────────────────────────────────────────────────────

  async getBatchData(
    spreadsheetId: string,
    ranges: string[],
  ): Promise<string[][][]> {
    const sheets = this.getSheetsClient();
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
    });
    return (response.data.valueRanges ?? []).map((r) => r.values ?? [[]]);
  }

  async readSheet(spreadsheetId: string, sheetName: string): Promise<SheetData> {
    try {
      await this.ensureSheetExists(spreadsheetId, sheetName);
      const sheets = this.getSheetsClient();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!B:K`,
      });
      const rows = response.data.values || [];
      return { sheetName, headers: rows[0] || [], rows: rows.slice(1) };
    } catch (error: unknown) {
      this.logger.error(
        `readSheet xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ─── Sheet management ──────────────────────────────────────────────────────

  async ensureSheetExists(
    spreadsheetId: string,
    sheetName: string,
  ): Promise<void> {
    const sheets = this.getSheetsClient();
    try {
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const exists = spreadsheet.data.sheets?.some(
        (s) => s.properties?.title === sheetName,
      );
      if (!exists) {
        await this.createSheet(spreadsheetId, sheetName);
      }
    } catch (error: unknown) {
      this.logger.error(
        `ensureSheetExists xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async createSheet(spreadsheetId: string, sheetName: string): Promise<void> {
    const sheets = this.getSheetsClient();
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `${sheetName}!B2`,
              values: [['Расходы (Xarajatlar)']],
            },
            {
              range: `${sheetName}!H2`,
              values: [['Доходы (Daromadlar)']],
            },
            {
              range: `${sheetName}!B4:E4`,
              values: [['Sana', 'Summa', 'Kategoriya', 'Tavsif']],
            },
            {
              range: `${sheetName}!G4:J4`,
              values: [['Sana', 'Tavsif', 'Kategoriya', 'Summa']],
            },
          ],
        },
      });

      this.logger.log(`✅ Sheet yaratildi: ${sheetName}`);
    } catch (error: unknown) {
      this.logger.error(
        `createSheet xatolik: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ─── Template copy (yangi user uchun) ─────────────────────────────────────

  async copyTemplateForUser(
    email: string,
    displayName: string,
    userAccessToken: string,
  ): Promise<string> {
    const userAuth = new google.auth.OAuth2();
    userAuth.setCredentials({ access_token: userAccessToken });

    const userDrive = google.drive({ version: 'v3', auth: userAuth });
    const templateId = this.configService.getOrThrow('TEMPLATE_SHEET_ID');

    const { data } = await userDrive.files.copy({
      fileId: templateId,
      requestBody: { name: `Cashflow — ${displayName}` },
      fields: 'id',
    });

    const newSheetId = data.id!;
    this.logger.log(`Yangi sheet yaratildi: ${newSheetId} (${email})`);

    // Google Drive propagation uchun kutish
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Service Account ga editor ruxsati berish
    await userDrive.permissions.create({
      fileId: newSheetId,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: this.configService.get<string>(
          'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        )!,
      },
      sendNotificationEmail: false,
      fields: 'id',
    });

    this.logger.log(`✅ Service account editor qilindi: ${newSheetId}`);
    return newSheetId;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async getSheetId(
    spreadsheetId: string,
    sheetName: string,
  ): Promise<number> {
    const sheets = this.getSheetsClient();
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === sheetName,
    );
    if (sheet?.properties?.sheetId == null) {
      throw new Error(`Sheet "${sheetName}" topilmadi`);
    }
    return sheet.properties.sheetId;
  }

  private async getNextAvailableRow(
    spreadsheetId: string,
    sheetName: string,
    type: 'income' | 'expense',
  ): Promise<number> {
    const sheets = this.getSheetsClient();
    const startRow = 5;
    // expense → B ustun (summa), income → H ustun (sana)
    const column = type === 'expense' ? 'C' : 'H';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${column}${startRow}:${column}1000`,
    });

    const rows = response.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i] || rows[i].length === 0 || !rows[i][0]) {
        return startRow + i;
      }
    }
    return startRow + rows.length;
  }
}