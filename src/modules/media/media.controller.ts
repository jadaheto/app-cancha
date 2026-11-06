import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { loadEnv } from '../../shared/config/env';
import { JwtAuthGuard } from '../../shared/infrastructure/auth/jwt-auth.guard';

/** Tipos de imagen aceptados → extensión con la que se guardan. */
const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Ruta pública con la que se sirven los archivos subidos (ver main.ts). */
export const UPLOADS_PUBLIC_PREFIX = '/api/uploads/';

interface UploadedImage { filename: string; size: number; mimetype: string; }

const storage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = loadEnv().uploadsDir;
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  // Nombre aleatorio: nunca se usa el nombre que envía el cliente.
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${ALLOWED[file.mimetype] ?? ''}`),
});

/** Subida de imágenes (fotos de canchas y sedes) desde el panel admin. */
@ApiTags('Medios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  @Post('images')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Sube una imagen (JPG, PNG o WebP, máx. 5 MB) y devuelve su URL' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED[file.mimetype]) cb(null, true);
        else cb(new BadRequestException('Solo se permiten imágenes JPG, PNG o WebP'), false);
      },
    }),
  )
  upload(@UploadedFile() file?: UploadedImage) {
    if (!file) throw new BadRequestException('Adjunta una imagen en el campo "file"');
    return { url: `${UPLOADS_PUBLIC_PREFIX}${file.filename}`, size: file.size, mimetype: file.mimetype };
  }
}
