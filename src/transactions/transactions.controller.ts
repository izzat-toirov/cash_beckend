// src/transactions/transactions.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { User } from '../auth/decorators/user.decorator';
import  type { JwtPayload } from '../auth/types/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Transactions — Tranzaksiyalar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // ── POST /transactions ────────────────────────────────────────────────────

  @Post()
  @ApiOperation({
    summary: "Yangi tranzaksiya qo'shish",
    description: `
Daromad yoki xarajat qo'shadi.

- \`type: "income"\` → G:J ustunlariga (Daromadlar)
- \`type: "expense"\` → B:E ustunlariga (Xarajatlar)
    `.trim(),
  })
  @ApiBody({ type: CreateTransactionDto })
  @ApiResponse({
    status: 201,
    description: "Tranzaksiya muvaffaqiyatli qo'shildi",
    schema: {
      example: {
        success: true,
        data: {
          date: '2026-04-15',
          amount: 500000,
          description: 'Aprel oyi maoshi',
          category: 'Maosh',
          type: 'income',
          sheetName: 'Aprel',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Noto'g'ri ma'lumotlar" })
  @ApiResponse({ status: 401, description: 'Token noto\'g\'ri yoki yo\'q' })
  create(@User() user: JwtPayload, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(user.sheetId, dto);
  }

  // ── GET /transactions/recent ──────────────────────────────────────────────

  @Get('recent')
  @ApiOperation({ summary: "So'nggi tranzaksiyalar — bugun yoki kecha" })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiResponse({ status: 200, description: "So'nggi 5 ta tranzaksiya" })
  findRecent(
    @User() user: JwtPayload,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const today = new Date();
    const m = month ? Number(month) : today.getMonth() + 1;
    const y = year ? Number(year) : today.getFullYear();
    return this.transactionsService.findRecent(user.sheetId, m, y);
  }

  // ── GET /transactions ─────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: "Tranzaksiyalar ro'yxati",
    description: "Berilgan oy va yil bo'yicha barcha tranzaksiyalar.",
  })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: [
          { id: 'expense-row-5', date: '2026-04-01', amount: 50000, description: 'Taksi', category: 'Transport', type: 'expense' },
          { id: 'income-row-5', date: '2026-04-01', amount: 5000000, description: 'Maosh', category: 'Maosh', type: 'income' },
        ],
        meta: { total: 100, page: 1, limit: 10, totalPages: 10 },
      },
    },
  })
  findAll(
    @User() user: JwtPayload,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const m = month ? Number(month) : new Date().getMonth() + 1;
    const y = year ? Number(year) : new Date().getFullYear();
    const p = page ? Number(page) : 1;
    const l = limit ? Number(limit) : 10;
    return this.transactionsService.findByMonth(user.sheetId, m, y, p, l);
  }

  // ── GET /transactions/:id ─────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Bitta tranzaksiyani olish' })
  @ApiParam({ name: 'id', type: String, example: 'expense-row-5' })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiResponse({ status: 200, description: 'Tranzaksiya topildi' })
  @ApiResponse({ status: 404, description: 'Tranzaksiya topilmadi' })
  findOne(
    @User() user: JwtPayload,
    @Param('id') id: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.transactionsService.findOne(
      user.sheetId,
      id,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
    );
  }

  // ── PATCH /transactions/:id ───────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Tranzaksiyani yangilash',
    description: '`id` formati: `expense-row-5` yoki `income-row-7`',
  })
  @ApiParam({ name: 'id', type: String, example: 'expense-row-5' })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiBody({ type: UpdateTransactionDto })
  @ApiResponse({ status: 200, description: 'Tranzaksiya yangilandi' })
  @ApiResponse({ status: 404, description: 'Tranzaksiya topilmadi' })
  update(
    @User() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const enrichedDto = {
      ...dto,
      month: month ? Number(month) : dto.month,
      year: year ? Number(year) : dto.year,
    };
    return this.transactionsService.update(user.sheetId, id, enrichedDto);
  }

  // ── DELETE /transactions/:id ──────────────────────────────────────────────

  @Delete(':id')
  @ApiOperation({
    summary: "Tranzaksiyani o'chirish",
    description: '`id` formati: `expense-row-5` yoki `income-row-7`',
  })
  @ApiParam({ name: 'id', type: String, example: 'income-row-7' })
  @ApiQuery({ name: 'month', required: false, type: Number, example: 4 })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  @ApiResponse({ status: 200, description: "Tranzaksiya o'chirildi" })
  remove(
    @User() user: JwtPayload,
    @Param('id') id: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.transactionsService.remove(
      user.sheetId,
      id,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
    );
  }
}