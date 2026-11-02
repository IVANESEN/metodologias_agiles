// Decodificación completa, además del formato declarado: leer solo la cabecera
// no detecta imágenes truncadas ni daños en los bloques de píxeles.
import sharp from 'sharp';
import { crc32 } from 'node:zlib';

export const MAX_PHOTO_BYTES = 1_000_000;
export const MAX_PHOTO_SIDE = 8192;
export const MAX_PHOTO_PIXELS = 20_000_000;

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_PHOTO';
  return error;
}

function completeContainer(format, bytes) {
  // libpng puede producir píxeles aunque falte IEND. Además del raster exigimos
  // un contenedor completo y CRC íntegro de cada bloque, incluidos metadatos.
  if (format === 'png') {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
    let offset = 8;
    let sawData = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) return false;
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (!/^[A-Za-z]{4}$/.test(type) || (offset === 8 && (type !== 'IHDR' || length !== 13))) return false;
      if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
      if (type === 'IDAT') sawData = true;
      if (type === 'IEND') return length === 0 && sawData && end === bytes.length;
      offset = end;
    }
    return false;
  }
  if (format === 'jpeg') {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (format === 'webp') {
    return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
  }
  return false;
}

/** Conserva los bytes originales únicamente después de decodificar todos sus píxeles. */
export async function validarFotografia(value, { maxBytes = MAX_PHOTO_BYTES } = {}) {
  const match = typeof value === 'string'
    ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value) : null;
  if (!match || match[2].length % 4 !== 0) {
    throw invalid('Adjunta una fotografía JPEG, PNG o WebP con contenido válido.');
  }
  // Evita reservar un buffer grande antes de comprobar el límite comprimido.
  if (match[2].length > Math.ceil(maxBytes / 3) * 4) {
    throw invalid(`Cada fotografía debe ocupar como máximo ${maxBytes} bytes.`);
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) {
    throw invalid('La codificación de la fotografía no es válida.');
  }
  if (!bytes.length || bytes.length > maxBytes) {
    throw invalid(`Cada fotografía debe ocupar como máximo ${maxBytes} bytes.`);
  }
  if (!completeContainer(match[1], bytes)) {
    throw invalid('La fotografía está dañada, incompleta o su contenido no coincide con el formato declarado.');
  }
  let metadata;
  try {
    metadata = await sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_PHOTO_PIXELS }).metadata();
  } catch {
    throw invalid('La fotografía está dañada, incompleta o supera el límite de 20 millones de píxeles.');
  }
  if (metadata.format !== match[1]) {
    throw invalid('El contenido de la fotografía no coincide con el formato declarado.');
  }
  if (!metadata.width || !metadata.height || metadata.width > MAX_PHOTO_SIDE || metadata.height > MAX_PHOTO_SIDE ||
    metadata.width * metadata.height > MAX_PHOTO_PIXELS || (metadata.pages || 1) !== 1) {
    throw invalid('La fotografía debe ser estática, de hasta 8192 píxeles por lado y 20 millones de píxeles en total.');
  }
  try {
    // metadata() no decodifica el raster: raw().toBuffer() obliga a leerlo entero.
    await sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_PHOTO_PIXELS }).raw().toBuffer();
  } catch {
    throw invalid('La fotografía está dañada o incompleta y no se puede leer completamente.');
  }
  return { dataUrl: value, width: metadata.width, height: metadata.height, bytes: bytes.length };
}
