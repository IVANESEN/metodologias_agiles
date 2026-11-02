import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validarFotografia, MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS, MAX_PHOTO_SIDE } from './imagenes.mjs';
import { PNG, JPEG, WEBP } from './test-fotografias.mjs';

const asDataUrl = (type, bytes) => `data:image/${type};base64,${bytes.toString('base64')}`;

test('H01: acepta únicamente fotografías estáticas completamente decodificables', async () => {
  for (const dataUrl of [PNG, JPEG, WEBP]) {
    const photo = await validarFotografia(dataUrl);
    assert.deepEqual({ width: photo.width, height: photo.height }, { width: 2, height: 2 });
    assert.equal(photo.dataUrl, dataUrl);
    assert.equal(photo.bytes, Buffer.from(dataUrl.split(',')[1], 'base64').length);
  }
});

test('H01: rechaza cabeceras, corrupción y fotografías truncadas después de leer la cabecera', async () => {
  for (const dataUrl of [PNG, JPEG, WEBP]) {
    const type = dataUrl.slice(11, dataUrl.indexOf(';'));
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    for (const length of [16, Math.floor(bytes.length * 0.65), bytes.length - 1, bytes.length - 2, bytes.length - 12]) {
      await assert.rejects(validarFotografia(asDataUrl(type, bytes.subarray(0, length))), { code: 'INVALID_PHOTO' });
    }
  }
  // Esta muestra tenía firma PNG correcta, pero el raster/CRC estaba dañado.
  await assert.rejects(validarFotografia('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5ZkAAAAASUVORK5CYII='),
    { code: 'INVALID_PHOTO' });
  await assert.rejects(validarFotografia(PNG.replace('image/png', 'image/jpeg')), /formato declarado/);
});

test('H01: aplica límites de bytes, dimensiones y píxeles antes de decodificar el raster', async () => {
  await assert.rejects(validarFotografia(asDataUrl('png', Buffer.alloc(MAX_PHOTO_BYTES + 1))), /máximo/);
  const wide = await sharp({ create: { width: MAX_PHOTO_SIDE + 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(validarFotografia(asDataUrl('png', wide)), /8192/);
  const height = Math.floor(MAX_PHOTO_PIXELS / 5000) + 1;
  const huge = await sharp({ create: { width: 5000, height, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(validarFotografia(asDataUrl('png', huge)), /píxeles/);
});
