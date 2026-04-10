import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(private readonly sheetsService: GoogleSheetsService) {}


  async create(dto: CreateTransactionDto) {
    const year = dto.year ?? new Date().getFullYear();
    const month = dto.month ?? new Date().getMonth() + 1;
    const sheetName = this.sheetsService.getSheetName(year, month);

    if (dto.type === 'expense') {
      await this.sheetsService.addExpenseRow(sheetName, [
        dto.date,                
        String(dto.amount),      
        dto.category,       
        dto.description ?? '',    
      ]);
    } else {
      await this.sheetsService.addIncomeRow(sheetName, [
        dto.date,                   
        String(dto.amount),       
        dto.category,              
        dto.description ?? '',     
      ]);
    }

    return { success: true, data: { ...dto, sheetName } };
  }

  // ─── PATCH /transactions/:id ──────────────────────────────────────────────────

  async update(id: string, dto: UpdateTransactionDto) {
    const { type, rowIndex, sheetName } = this.parseId(id, dto);

    const records = await this.sheetsService.getFinanceRecords(sheetName);
    const existing = records.find((r) => r.id === id);
    if (!existing) throw new NotFoundException(`Transaction "${id}" topilmadi`);

    if (type === 'expense') {
      // ✅ B:E: [date, amount, description, category]
      await this.sheetsService.updateRow(
        sheetName,
        rowIndex,
        [
          dto.date ?? existing.date,
          String(dto.amount ?? existing.amount),
          dto.description ?? existing.description ?? '',
          dto.category ?? existing.category,
        ],
        'expense',
      );
    } else {
      // ✅ H:K: [date, description, category, amount]
      await this.sheetsService.updateRow(
        sheetName,
        rowIndex,
        [
          dto.date ?? existing.date,
          String(dto.amount ?? existing.amount),
          dto.description ?? existing.description ?? '',
          dto.category ?? existing.category,
        ],
        'income',
      );
    }

    return { success: true, id };
  }

  // ─── GET /transactions?month=5&year=2026 ─────────────────────────────────────

  async findByMonth(month: number, year: number, page: number, limit: number) {
    const sheetName = this.sheetsService.getSheetName(year, month);
    const records = await this.sheetsService.getFinanceRecords(sheetName);
  
    const sorted = [...records].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  
    const total = sorted.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const data = sorted.slice(start, start + limit);
  
    return {
      success: true,
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async findRecent(month: number, year: number) {
    const sheetName = this.sheetsService.getSheetName(year, month);
    const records = await this.sheetsService.getFinanceRecords(sheetName);
  
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
  
    const formatDate = (d: Date): string =>
      `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  
    const todayStr = formatDate(today);
    const yesterdayStr = formatDate(yesterday);
  
    const filtered = records.filter(
      (r) => r.date === todayStr || r.date === yesterdayStr
    );
  
    const sorted = [...(filtered.length > 0 ? filtered : records)]
      .sort((a, b) => {
        const parseDate = (str: string) => {
          const [dd, mm, yyyy] = str.split('.');
          return new Date(`${yyyy}-${mm}-${dd}`).getTime();
        };
        return parseDate(b.date) - parseDate(a.date);
      })
      .slice(0, 5);
  
    return {
      success: true,
      data: sorted,
    };
  }

  // ─── GET /transactions/:id ────────────────────────────────────────────────────

  async findOne(id: string, month?: number, year?: number) {
    const m = month ?? new Date().getMonth() + 1;
    const y = year ?? new Date().getFullYear();
    const sheetName = this.sheetsService.getSheetName(y, m);

    const records = await this.sheetsService.getFinanceRecords(sheetName);
    const record = records.find((r) => r.id === id);

    if (!record) throw new NotFoundException(`Transaction "${id}" topilmadi`);
    return { success: true, data: record };
  }

  // ─── DELETE /transactions/:id ─────────────────────────────────────────────────

  async remove(id: string, month?: number, year?: number) {
    const { rowIndex, sheetName } = this.parseId(id, { month, year });
    await this.sheetsService.deleteRow(sheetName, rowIndex);
    return { success: true, message: "Transaction o'chirildi", id };
  }

  // ─── HELPER ───────────────────────────────────────────────────────────────────

  private parseId(
    id: string,
    opts: { month?: number; year?: number },
  ): { type: 'income' | 'expense'; rowIndex: number; sheetName: string } {
    const match = id.match(/^(income|expense)-row-(\d+)$/);
    if (!match) throw new NotFoundException(`Noto'g'ri transaction id: "${id}"`);

    const type = match[1] as 'income' | 'expense';
    const rowIndex = Number(match[2]);
    const year = opts.year ?? new Date().getFullYear();
    const month = opts.month ?? new Date().getMonth() + 1;
    const sheetName = this.sheetsService.getSheetName(year, month);

    return { type, rowIndex, sheetName };
  }
}