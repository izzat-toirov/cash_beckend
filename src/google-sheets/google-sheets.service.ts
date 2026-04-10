import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import {
  FinanceRecord,
  SheetData,
  SvodkaData,
} from '../common/types/finance.types';
import { SHEET_CONSTANTS } from '../common/constants/sheets.constants';
import { safeParseFloat } from '../common/utils/number-validation.util';

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);

  public sheets: sheets_v4.Sheets;
  public spreadsheetId: string;

  private readonly MONTHS_UZ = [
    'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
    'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
  ];

  constructor(private configService: ConfigService) {
    const sheetId = this.configService.get<string>('GOOGLE_SHEET_ID');
    if (!sheetId) {
      throw new Error('GOOGLE_SHEET_ID is not configured');
    }
    this.spreadsheetId = sheetId;

    const privateKey = this.configService.get<string>('GOOGLE_PRIVATE_KEY');
    if (!privateKey) {
      throw new Error('GOOGLE_PRIVATE_KEY is not configured');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        private_key: privateKey.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }


  getCurrentMonthSheetName(): string {
    const now = new Date();
    return this.MONTHS_UZ[now.getMonth()];
  }

  getSheetName(year: number, month: number): string {
    return this.MONTHS_UZ[month - 1];
  }

  async getCellValue(sheetName: string, cell: string): Promise<number> {
    const resp = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${cell}`,
    });
    const raw = resp.data.values?.[0]?.[0] ?? '0';
    return parseFloat(String(raw).replace(/[^\d.-]/g, '')) || 0;
  }


  async addExpenseRow(sheetName: string, rowData: string[]): Promise<void> {
    try {
      await this.ensureSheetExists(sheetName);
      const nextRow = await this.getNextAvailableRow(sheetName, 'expense');

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!B${nextRow}:E${nextRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] },
      });

      this.logger.log(`✅ Xarajat ${nextRow}-qatorga yozildi (B:E): ${JSON.stringify(rowData)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`addExpenseRow xatolik: ${message}`);
      throw error;
    }
  }

  async addIncomeRow(sheetName: string, rowData: string[]): Promise<void> {
    try {
      await this.ensureSheetExists(sheetName);
      const nextRow = await this.getNextAvailableRow(sheetName, 'income');

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!G${nextRow}:J${nextRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] },
      });

      this.logger.log(`✅ Daromad ${nextRow}-qatorga yozildi (G:J): ${JSON.stringify(rowData)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`addIncomeRow xatolik: ${message}`);
      throw error;
    }
  }

  async addRow(sheetName: string, rowData: string[]): Promise<void> {
    const type = rowData[rowData.length - 1];

    if (type === 'expense') {
      await this.addExpenseRow(sheetName, [
        rowData[0],
        rowData[2],
        rowData[3],
        rowData[4],
      ]);
    } else if (type === 'income') {
      await this.addIncomeRow(sheetName, [
        rowData[0],
        rowData[3], 
        rowData[4],
        rowData[2], 
      ]);
    } else {
      throw new Error(`Noto'g'ri type: "${type}"`);
    }
  }


  async getFinanceRecords(sheetName: string): Promise<FinanceRecord[]> {
    const records: FinanceRecord[] = [];

    try {
      const expenseResp = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
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
      this.logger.error(`Xarajat o'qishda xatolik: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const incomeResp = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
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
      this.logger.error(`Daromad o'qishda xatolik: ${error instanceof Error ? error.message : String(error)}`);
    }

    return records;
  }


  async updateRow(
    sheetName: string,
    rowIndex: number,
    rowData: string[],
    type: 'income' | 'expense',
  ): Promise<void> {
    try {
      await this.ensureSheetExists(sheetName);

      let range: string;
      let values: string[];

      if (type === 'expense') {
        range = `${sheetName}!B${rowIndex}:E${rowIndex}`;
        values = rowData;
      } else {
        range = `${sheetName}!H${rowIndex}:K${rowIndex}`;
        values = [
          rowData[0],
          rowData[2],
          rowData[3],
          rowData[1],
        ];
      }

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [values] },
      });

      this.logger.log(`✅ Yangilandi: ${range}`);
    } catch (error: unknown) {
      this.logger.error(`updateRow xatolik: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }


  async deleteRow(sheetName: string, rowIndex: number): Promise<void> {
    try {
      await this.ensureSheetExists(sheetName);
      const sheetId = await this.getSheetId(sheetName);

      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
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
      this.logger.error(`deleteRow xatolik: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }


  async getCategories(): Promise<{ name: string; type: string }[]> {
    try {
      const response = await this.sheets.spreadsheets.values.batchGet({
        spreadsheetId: this.spreadsheetId,
        ranges: [
          'Сводка!B38:B1000',
          'Сводка!H38:H1000', 
        ],
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
      this.logger.error(`getCategories xatolik: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async getValidCategories(): Promise<{ expenses: string[]; income: string[] }> {
    const ranges = ['Сводка!B28:B45', 'Сводка!H28:H45'];
    const data = await this.getBatchData(ranges);

    return {
      expenses: data[0]?.flat().filter((c) => c && isNaN(Number(c))) || [],
      income: data[1]?.flat().filter((c) => c && isNaN(Number(c))) || [],
    };
  }

  async validateCategoryStrict(
    category: string,
    type: 'income' | 'expense',
  ): Promise<{ isValid: boolean; normalized?: string }> {
    try {
      const range = type === 'expense' ? 'Сводка!B28:B45' : 'Сводка!H28:H45';
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
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
      this.logger.error(`validateCategoryStrict xatolik: ${error instanceof Error ? error.message : String(error)}`);
      return { isValid: false };
    }
  }


  async readSvodka(): Promise<SvodkaData> {
    try {
      const resp = await this.sheets.spreadsheets.values.batchGet({
        spreadsheetId: this.spreadsheetId,
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
        parseFloat(String(vr?.values?.[0]?.[0] || '0').replace(/[^\d.-]/g, '')) || 0;

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

      return { expensePlanned, expenseActual, incomePlanned, incomeActual, expenseCategories, incomeCategories };
    } catch (error: unknown) {
      this.logger.error(`readSvodka xatolik: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async getInitialAmount(): Promise<number> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Сводка!I8',
      });
      const raw = response.data.values?.[0]?.[0];
      if (!raw) return 0;
      return parseFloat(String(raw).replace(/[^\d.-]/g, '')) || 0;
    } catch (error: unknown) {
      this.logger.error(`getInitialAmount xatolik: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  async setInitialAmount(amount: number): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Сводка!I8',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[String(amount)]] },
      });
      this.logger.log(`✅ Initial amount set: ${amount}`);
    } catch (error: unknown) {
      this.logger.error(`setInitialAmount xatolik: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async getBatchData(ranges: string[]): Promise<string[][][]> {
    const response = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: this.spreadsheetId,
      ranges,
    });
    return (response.data.valueRanges ?? []).map((r) => r.values ?? [[]]);
  }

  async getValuesWithFormulas(range: string): Promise<string[][]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
      valueRenderOption: 'FORMULA',
    });
    return response.data.values ?? [];
  }

  async validateSheetNameSync(sheetName: string): Promise<boolean> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Сводка!D10',
      });
      const svodkaMonth = response.data.values?.[0]?.[0];
      const monthOnly = sheetName.split(' ')[0];
      return svodkaMonth === monthOnly;
    } catch (error: unknown) {
      this.logger.error(`validateSheetNameSync xatolik: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }


  async ensureSheetExists(sheetName: string): Promise<void> {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      const exists = spreadsheet.data.sheets?.some(
        (s) => s.properties?.title === sheetName,
      );
      if (!exists) {
        await this.createSheet(sheetName);
      }
    } catch (error: unknown) {
      this.logger.error(`ensureSheetExists xatolik: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async createSheet(sheetName: string): Promise<void> {
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });

      // Sarlavhalar
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
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
              // ✅ B:E sarlavhalar
              range: `${sheetName}!B4:E4`,
              values: [['Sana', 'Summa', 'Tavsif', 'Kategoriya']],
            },
            {
              // ✅ H:K sarlavhalar
              range: `${sheetName}!H4:K4`,
              values: [['Sana', 'Tavsif', 'Kategoriya', 'Summa']],
            },
          ],
        },
      });

      this.logger.log(`✅ Sheet yaratildi: ${sheetName}`);
    } catch (error: unknown) {
      this.logger.error(`createSheet xatolik: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async readSheet(sheetName: string): Promise<SheetData> {
    try {
      await this.ensureSheetExists(sheetName);
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!B:K`,
      });
      const rows = response.data.values || [];
      return { sheetName, headers: rows[0] || [], rows: rows.slice(1) };
    } catch (error: unknown) {
      this.logger.error(`readSheet xatolik: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }


  private async getSheetId(sheetName: string): Promise<number> {
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });
    const sheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === sheetName,
    );
    if (sheet?.properties?.sheetId == null) {
      throw new Error(`Sheet "${sheetName}" topilmadi`);
    }
    return sheet.properties.sheetId;
  }


  private async getNextAvailableRow(
    sheetName: string,
    type: 'income' | 'expense',
  ): Promise<number> {
    const startRow = 5;
    const column = type === 'expense' ? 'C' : 'H';

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
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

  async getInitialAmounts(): Promise<{
    items: { label: string; amount: number }[];
    totalBalance: number;
    currentBalance: number; 
  }> {
    try {
      const [amountsResp, balanceResp, currentBalanceResp] = await Promise.all([
        this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `Сводка!C17:E21`,
        }),
        this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `Сводка!F17`,
        }),
        this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `Сводка!H17`,
        }),
      ]);
  
      const parseSheetNumber = (str: string | undefined): number => {
        if (!str) return 0;
        return parseFloat(str.replace(/\s/g, '').replace(',', '.')) || 0;
      };
  
      const rows = amountsResp.data.values || [];
      const totalBalance = parseSheetNumber(String(balanceResp.data.values?.[0]?.[0] || ''));
      const currentBalance = parseSheetNumber(String(currentBalanceResp.data.values?.[0]?.[0] || ''));
  
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
  
  async updateInitialAmount(rowIndex: number, amount: number): Promise<{ success: boolean; message: string; sheetRow: number; amount: number }> {
    let sheetRow: number;
  
    if (rowIndex >= 17 && rowIndex <= 21) {
      sheetRow = rowIndex;
    } else if (rowIndex >= 0 && rowIndex <= 4) {
      sheetRow = 17 + rowIndex;
    } else {
      throw new BadRequestException('rowIndex 0–4 yoki 17–21 bo\'lishi kerak');
    }
  
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Сводка!E${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[amount.toString()]] },
      });
  
      this.logger.log(`✅ InitialAmount ${sheetRow}-qator yangilandi: ${amount}`);
      
      return {
        success: true,
        message: "Summa muvaffaqiyatli yangilandi",
        sheetRow,
        amount,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`updateInitialAmount xatolik: ${message}`);
      throw error;
    }
  }

  async copyTemplateForUser(
    email: string,
    displayName: string,
    userAccessToken: string, // ← qo'shildi
  ): Promise<string> {
    // User o'z tokenini ishlatadi — fayl USER Drive'ida yaratiladi
    const userAuth = new google.auth.OAuth2();
    userAuth.setCredentials({ access_token: userAccessToken });
  
    const userDrive = google.drive({ version: 'v3', auth: userAuth });
    const templateId = this.configService.getOrThrow('TEMPLATE_SHEET_ID');
  
    // Fayl USER'ning Drive'ida yaratiladi — quota muammosi yo'q
    const { data } = await userDrive.files.copy({
      fileId: templateId,
      requestBody: {
        name: `Cashflow — ${displayName}`,
      },
      fields: 'id',
    });
  
    const newSheetId = data.id!;
    this.logger.log(`Yangi sheet yaratildi: ${newSheetId} (${email})`);
  
    // Service Account'ga editor ruxsat berish — keyingi yozishlar uchun
    const serviceAuth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        private_key: this.configService.get<string>('GOOGLE_PRIVATE_KEY')!.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  
    const serviceDrive = google.drive({ version: 'v3', auth: serviceAuth });
  
    await serviceDrive.permissions.create({
      fileId: newSheetId,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL')!,
      },
      sendNotificationEmail: false,
    });
  
    this.logger.log(`Service account editor qilindi: ${newSheetId}`);
    return newSheetId;
  }
}
