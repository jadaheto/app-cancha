import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/infrastructure/auth/jwt-auth.guard';
import { SettingsService } from '../application/settings.service';
import { UpdateBrandDto } from '../application/dto/update-brand.dto';
import { UpdateScheduleDto } from '../application/dto/update-schedule.dto';

@ApiTags('Configuración')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('brand')
  @ApiOperation({ summary: 'Obtiene la configuración de marca' })
  getBrand() {
    return this.settings.getBrand();
  }

  @Put('brand')
  @ApiOperation({ summary: 'Actualiza la configuración de marca' })
  updateBrand(@Body() dto: UpdateBrandDto) {
    return this.settings.updateBrand(dto);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Horario de atención del portal' })
  getSchedule() {
    return this.settings.getSchedule();
  }

  @Put('schedule')
  @ApiOperation({ summary: 'Actualiza el horario de atención del portal' })
  updateSchedule(@Body() dto: UpdateScheduleDto) {
    return this.settings.updateSchedule(dto);
  }

  @Delete('schedule')
  @ApiOperation({ summary: 'Restablece el horario por defecto (variables de entorno)' })
  resetSchedule() {
    return this.settings.resetSchedule();
  }
}
