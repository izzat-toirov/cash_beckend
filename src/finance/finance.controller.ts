// src/finance/finance.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Patch,
  ParseIntPipe,
} from '@nestjs/common';
import { FinanceService } from './finance.service';
import {
  CreateFinanceRecordDto,
  UpdateFinanceRecordDto,
} from './dto/finance-record.dto';
import type { JwtPayload } from '../auth/types/auth.types';
import { User } from '../auth/decorators/user.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('finance')
@UseGuards(JwtAuthGuard)          // ✅ JWT Guard — barcha route'lar himoyalangan
@ApiTags('Finance — Moliyaviy yozuvlar')
@ApiBearerAuth()                  // Swagger: Authorization: Bearer <token>
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // ── POST /finance ─────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({
    summary: "Yangi moliyaviy yozuv qo'shish",
    description: `
Daromad yoki xarajat qo'shadi. \`date\` maydonidan avtomatik sheet nomi aniqlanadi.

- \`type: "income"\` → G:J ustunlariga yoziladi
- \`type: "expense"\` → B:E ustunlariga yoziladi
    `.trim(),
  })
  @ApiBody({ type: CreateFinanceRecordDto })
  @ApiResponse({ status: 201, description: "Yozuv muvaffaqiyatli qo'shildi" })
  @ApiResponse({ status: 400, description: "Noto'g'ri ma'lumotlar yoki kategoriya" })
  @ApiResponse({ status: 401, description: 'Token noto\'g\'ri yoki yo\'q' })
  async addRecord(
    @User() user: JwtPayload,                  // ✅ JWT dan user olinadi
    @Body() dto: CreateFinanceRecordDto,
  ) {
    await this.financeService.addFinanceRecord(user.sheetId, dto);
    return { message: "Ma'lumot muvaffaqiyatli saqlandi" };
  }

  // ── GET /finance ──────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Joriy oy yozuvlarini olish',
    description: "Joriy oy bo'yicha foydalanuvchining barcha yozuvlarini qaytaradi.",
  })
  @ApiResponse({ status: 200, description: 'Joriy oy yozuvlari' })
  async getCurrentMonthRecords(@User() user: JwtPayload) {
    return this.financeService.getCurrentMonthRecords(user.sheetId);
  }

  // ── GET /finance/balance ──────────────────────────────────────────────────

  @Get('balance')
  @ApiOperation({
    summary: 'Balansni hisoblash',
    description: 'Joriy yoki tanlangan oy uchun daromad, xarajat va sof balans.',
  })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiResponse({
    status: 200,
    schema: {
      example: { totalIncome: 1500000, totalExpense: 1000000, balance: 500000 },
    },
  })
  async getBalance(
    @User() user: JwtPayload,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.financeService.calculateBalance(
      user.sheetId,
      year ? parseInt(year) : undefined,
      month ? parseInt(month) : undefined,
    );
  }

  // ── GET /finance/categories ───────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({
    summary: "Kategoriyalar ro'yxati",
    description: "Foydalanuvchining Сводка sheetidan kategoriyalarni oladi.",
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: [
        { name: 'Maosh', type: 'income' },
        { name: 'Transport', type: 'expense' },
      ],
    },
  })
  async getCategories(@User() user: JwtPayload) {
    return this.financeService.getCategories(user.sheetId);
  }

  // ── GET /finance/records ──────────────────────────────────────────────────

  @Get('records')
  @ApiOperation({
    summary: "Filter bo'yicha yozuvlarni olish",
    description: `
- \`year\` + \`month\` → o'sha oyning yozuvlari
- Faqat \`year\` → butun yilning barcha oylari
- Hech narsa yo'q → joriy oy
    `.trim(),
  })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiResponse({ status: 200, description: 'Filtrlangan yozuvlar' })
  async getFilteredRecords(
    @User() user: JwtPayload,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.financeService.getFilteredRecords(
      user.sheetId,
      year ? parseInt(year) : undefined,
      month ? parseInt(month) : undefined,
    );
  }

  // ── GET /finance/month ────────────────────────────────────────────────────

  @Get('month')
  @ApiOperation({ summary: 'Aniq bir oy yozuvlarini olish' })
  @ApiQuery({ name: 'year', type: Number, required: true, example: 2026 })
  @ApiQuery({ name: 'month', type: Number, required: true, example: 4 })
  @ApiResponse({ status: 200, description: "So'ralgan oy yozuvlari" })
  async getMonthRecords(
    @User() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.financeService.getMonthRecords(
      user.sheetId,
      parseInt(year),
      parseInt(month),
    );
  }

  // ── PUT /finance/:id ──────────────────────────────────────────────────────

  @Put(':id')
  @ApiOperation({
    summary: 'Moliyaviy yozuvni yangilash',
    description: '`id` formati: `expense-row-5` yoki `income-row-7`',
  })
  @ApiParam({ name: 'id', type: String, example: 'expense-row-5' })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiBody({ type: UpdateFinanceRecordDto })
  @ApiResponse({ status: 200, description: 'Yozuv muvaffaqiyatli yangilandi' })
  async updateRecord(
    @User() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceRecordDto,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    await this.financeService.updateFinanceRecord(
      user.sheetId,
      id,
      dto,
      year ? parseInt(year) : undefined,
      month ? parseInt(month) : undefined,
    );
    return { message: 'Yozuv muvaffaqiyatli yangilandi', id };
  }

  // ── DELETE /finance/:id ───────────────────────────────────────────────────

  @Delete(':id')
  @ApiOperation({
    summary: "Moliyaviy yozuvni o'chirish",
    description: '`id` formati: `expense-row-5` yoki `income-row-7`',
  })
  @ApiParam({ name: 'id', type: String, example: 'income-row-7' })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiResponse({ status: 200, description: "Yozuv muvaffaqiyatli o'chirildi" })
  async deleteRecord(
    @User() user: JwtPayload,
    @Param('id') id: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    await this.financeService.deleteFinanceRecord(
      user.sheetId,
      id,
      year ? parseInt(year) : undefined,
      month ? parseInt(month) : undefined,
    );
    return { message: "Yozuv muvaffaqiyatli o'chirildi", id };
  }

  // ── GET /finance/initial-amounts ──────────────────────────────────────────

  @Get('initial-amounts')
  @ApiOperation({
    summary: "Boshlang'ich summalarni olish",
    description: `Сводка sheetidan C17:E21 oralig'idagi boshlang'ich summalar.
- 0: Uzum bank karta
- 1: Uzcard 2582
- 2: Naqd pullar so'm
- 3: Naqd AQSH dollari
- 4: Va boshqalar`,
  })
  @ApiResponse({ status: 200, description: "Boshlang'ich summalar" })
  async getInitialAmounts(@User() user: JwtPayload) {
    return this.financeService.getInitialAmounts(user.sheetId);
  }

  // ── PATCH /finance/initial-amounts/:rowIndex ──────────────────────────────

  @Patch('initial-amounts/:rowIndex')
  @ApiOperation({
    summary: "Boshlang'ich summani yangilash",
    description: `Сводка sheetidagi E17:E21 qatorlaridan birini yangilaydi.
- 0 → E17 | 1 → E18 | 2 → E19 | 3 → E20 | 4 → E21`,
  })
  @ApiParam({ name: 'rowIndex', type: Number, example: 0 })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { amount: { type: 'number', example: 150000 } },
      required: ['amount'],
    },
  })
  @ApiResponse({ status: 200, description: 'Summa muvaffaqiyatli yangilandi' })
  async updateInitialAmount(
    @User() user: JwtPayload,
    @Param('rowIndex', ParseIntPipe) rowIndex: number,
    @Body('amount') amount: number,
  ) {
    return this.financeService.updateInitialAmount(user.sheetId, rowIndex, amount);
  }

  // ── GET /finance/sheets ───────────────────────────────────────────────────

  @Get('sheets')
  @ApiOperation({
    summary: "Mavjud oylar ro'yxati",
    description: "Foydalanuvchining spreadsheet'idagi oy sheetlari.",
  })
  @ApiResponse({
    status: 200,
    schema: { example: { sheets: ['Mart', 'Aprel', 'May'] } },
  })
  async getAvailableSheets(@User() user: JwtPayload) {
    return this.financeService.getAvailableSheets(user.sheetId);
  }

  // ── PATCH /finance/sheets/active ─────────────────────────────────────────

  @Patch('sheets/active')
  @ApiOperation({
    summary: "Aktiv oyni o'zgartirish",
    description: "Сводка F2 katakdagi dropdown qiymatini yangilaydi.",
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { sheetName: { type: 'string', example: 'May' } },
      required: ['sheetName'],
    },
  })
  @ApiResponse({ status: 200, description: "Aktiv oy o'zgartirildi" })
  async setActiveSheet(
    @User() user: JwtPayload,
    @Body('sheetName') sheetName: string,
  ) {
    return this.financeService.setActiveSheet(user.sheetId, sheetName);
  }

  // ── GET /finance/sheets/active ────────────────────────────────────────────

  @Get('sheets/active')
  @ApiOperation({
    summary: 'Hozirgi aktiv oyni olish',
    description: "Сводка F2 katakdagi joriy qiymat.",
  })
  @ApiResponse({
    status: 200,
    schema: { example: { name: 'Aprel', month: 4, year: 2026 } },
  })
  async getActiveSheet(@User() user: JwtPayload) {
    return this.financeService.getActiveSheet(user.sheetId);
  }
}