import {
  BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Ip, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { loadEnv } from '../../shared/config/env';
import { courtToView } from '../courts/application/court.mapper';
import { CourtsService } from '../courts/application/courts.service';
import { CreateReservationDto } from '../reservations/application/dto/create-reservation.dto';
import { QuoteDto } from '../reservations/application/dto/quote.dto';
import { VerifyCodeDto } from '../reservations/application/dto/update-status.dto';
import { reservationToView } from '../reservations/application/reservation.mapper';
import { ReservationsService } from '../reservations/application/reservations.service';
import { PhoneVerificationService, normalizePhone } from '../reservations/application/phone-verification.service';
import { SendPhoneCodeDto, VerifyPhoneCodeDto } from '../reservations/application/dto/phone-verification.dto';
import { VerifyPaymentDto } from '../reservations/application/dto/verify-payment.dto';
import { SettingsService } from '../settings/application/settings.service';

/** Endpoints públicos (sin autenticación) para el portal y el flujo de reserva. */
@ApiTags('Público')
@Controller('public')
export class PublicController {
  constructor(
    private readonly settings: SettingsService,
    private readonly courts: CourtsService,
    private readonly reservations: ReservationsService,
    private readonly phones: PhoneVerificationService,
  ) {}

  @Get('brand')
  @ApiOperation({ summary: 'Configuración de marca para el portal' })
  brand() {
    return this.settings.getBrand();
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Horario de atención del portal y minutos para pagar una reserva' })
  async schedule() {
    const { openHour, closeHour } = await this.settings.getSchedule();
    return { openHour, closeHour, paymentHoldMinutes: loadEnv().paymentHold.minutes };
  }

  @Get('courts')
  @ApiOperation({ summary: 'Recursos activos disponibles para reservar' })
  async courtsList() {
    return (await this.courts.findActive()).map(courtToView);
  }

  @Get('courts/:id')
  @ApiOperation({ summary: 'Detalle público de una cancha' })
  async courtDetail(@Param('id', ParseUUIDPipe) id: string) {
    return courtToView(await this.courts.findById(id));
  }

  @Get('courts/:id/availability')
  @ApiOperation({ summary: 'Horarios por hora de una cancha en un día, con precio y disponibilidad' })
  @ApiQuery({ name: 'date', example: '2026-11-15' })
  availability(@Param('id', ParseUUIDPipe) id: string, @Query('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw new BadRequestException('date debe tener formato YYYY-MM-DD');
    }
    return this.reservations.availability(id, date);
  }

  @Post('reservations/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cotiza una reserva' })
  quote(@Body() dto: QuoteDto) {
    // En el portal la tarifa depende de la categoría: el documento es obligatorio.
    requireDocument(dto.documentNumber);
    return this.reservations.quote({ ...dto, category: undefined });
  }

  @Post('phone/send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envía un código por WhatsApp para verificar el celular' })
  sendPhoneCode(@Body() dto: SendPhoneCodeDto, @Ip() ip: string) {
    return this.phones.sendCode(dto.phone, ip);
  }

  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valida el código y entrega un token para reservar con ese celular' })
  verifyPhoneCode(@Body() dto: VerifyPhoneCodeDto) {
    return this.phones.verify(dto.phone, dto.code);
  }

  @Post('reservations')
  @ApiOperation({ summary: 'Crea una reserva desde el portal' })
  async create(@Body() dto: CreateReservationDto) {
    requireDocument(dto.documentNumber);
    // Celular real: debe venir verificado con el código (OTP).
    this.phones.assertToken(dto.phoneToken, dto.customerPhone);
    dto.customerPhone = normalizePhone(dto.customerPhone!);
    // La categoría la determina el documento, nunca el cliente.
    dto.category = undefined;
    dto.isAffiliate = undefined;
    return reservationToView(await this.reservations.create(dto, { phoneVerified: true, enforceSchedule: true }));
  }

  @Post('reservations/:id/send-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envía el código de verificación' })
  sendVerification(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.sendVerification(id);
  }

  @Post('reservations/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifica el código y confirma la reserva' })
  async verify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyCodeDto) {
    return reservationToView(await this.reservations.verify(id, dto.code));
  }

  @Post('reservations/:id/payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia el pago de la reserva (checkout de ePayco)' })
  initPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.initPayment(id);
  }

  @Post('reservations/:id/verify-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consulta el pago en la pasarela (y el ref_payco del retorno, si llega) y confirma la reserva si corresponde' })
  async verifyPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyPaymentDto) {
    return reservationToView(await this.reservations.verifyPayment(id, dto.refPayco));
  }

  @Post('reservations/:id/payment-confirmation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Doble confirmación del pago: resultado de ePayco + confirmación de Comfasucre' })
  async paymentConfirmation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyPaymentDto) {
    const { reservation, gateway } = await this.reservations.checkPayment(id, dto.refPayco);
    return {
      reservation: reservationToView(reservation),
      gateway: gateway && {
        status: gateway.status,
        refPayco: gateway.refPayco ?? null,
        responseMessage: gateway.responseMessage ?? null,
        franchise: gateway.franchise ?? null,
        amount: gateway.amount ?? null,
        transactionDate: gateway.transactionDate ?? null,
        testRequest: gateway.testRequest ?? null,
      },
    };
  }

  @Get('reservations/:id')
  @ApiOperation({ summary: 'Detalle de una reserva (confirmación)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return reservationToView(await this.reservations.getById(id));
  }
}

/** Documento de identidad obligatorio en el portal (define la categoría y la tarifa). */
function requireDocument(documentNumber?: string): void {
  if (!documentNumber || !/^\d{5,12}$/.test(documentNumber.trim())) {
    throw new BadRequestException('El número de documento es obligatorio (solo números, 5 a 12 dígitos)');
  }
}
