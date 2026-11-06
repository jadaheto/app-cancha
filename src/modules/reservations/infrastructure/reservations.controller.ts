import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/infrastructure/auth/jwt-auth.guard';
import { ReservationsService } from '../application/reservations.service';
import { reservationToView } from '../application/reservation.mapper';
import { AdminCreateReservationDto, CashPaymentDto } from '../application/dto/admin-reservation.dto';
import { CurrentUser, CurrentUserData } from '../../../shared/infrastructure/auth/current-user.decorator';
import { QuoteDto } from '../application/dto/quote.dto';
import { UpdateStatusDto, VerifyCodeDto } from '../application/dto/update-status.dto';

/** Gestión de reservas desde el panel (protegido con JWT). */
@ApiTags('Reservas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista reservas (filtros opcionales)' })
  @ApiQuery({ name: 'date', required: false, example: '2026-11-15' })
  @ApiQuery({ name: 'courtId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findAll(
    @Query('date') date?: string,
    @Query('courtId') courtId?: string,
    @Query('status') status?: string,
  ) {
    const list = await this.reservations.list({ date, courtId, status });
    return list.map(reservationToView);
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cotiza el precio de una reserva' })
  quote(@Body() dto: QuoteDto) {
    return this.reservations.quote(dto);
  }

  @Get('payments')
  @ApiOperation({ summary: 'Lista los pagos hechos y confirmados' })
  async payments() {
    const list = await this.reservations.listPayments();
    return list.map(reservationToView);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene una reserva por id' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return reservationToView(await this.reservations.getById(id));
  }

  @Post()
  @ApiOperation({ summary: 'Crea una reserva desde el panel, pagada en caja o con link de ePayco' })
  async create(@Body() dto: AdminCreateReservationDto, @CurrentUser() admin: CurrentUserData) {
    const { reservation, checkoutUrl, paymentError } = await this.reservations.createByAdmin(dto, admin?.username ?? 'admin');
    return { ...reservationToView(reservation), checkoutUrl, paymentError: paymentError ?? null };
  }

  @Post(':id/cash-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registra el pago de la reserva recibido en caja' })
  async cashPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CashPaymentDto,
    @CurrentUser() admin: CurrentUserData,
  ) {
    return reservationToView(await this.reservations.registerCashPayment(id, dto.reference, admin?.username ?? 'admin'));
  }

  @Post(':id/verify-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consulta el pago en la pasarela y lo aplica si corresponde' })
  async verifyPayment(@Param('id', ParseUUIDPipe) id: string) {
    return reservationToView(await this.reservations.verifyPayment(id));
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambia el estado de una reserva' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto) {
    return reservationToView(await this.reservations.updateStatus(id, dto.status));
  }

  @Post(':id/send-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envía un código de verificación al cliente' })
  sendVerification(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.sendVerification(id);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifica el código y confirma la reserva' })
  async verify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyCodeDto) {
    return reservationToView(await this.reservations.verify(id, dto.code));
  }

  @Post(':id/payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia el pago de la reserva (pasarela)' })
  initPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.initPayment(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina una reserva' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.delete(id);
  }
}
