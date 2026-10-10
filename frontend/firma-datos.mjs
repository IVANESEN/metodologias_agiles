// Coordenadas independientes del tamaño de pantalla. Se comparten las mismas
// reglas entre el lienzo, la API y el PDF, sin aceptar imágenes arbitrarias.
export const FIRMA_ANCHO = 600;
export const FIRMA_ALTO = 240;
export const MAX_PUNTOS = 4000;
export const MAX_TRAZOS = 100;

export function normalizeSignature(firma) {
  const invalid = () => { throw new Error('La firma no tiene un formato válido. Vuelve a dibujarla.'); };
  if (!firma || firma.ancho !== FIRMA_ANCHO || firma.alto !== FIRMA_ALTO ||
      !Array.isArray(firma.trazos) || firma.trazos.length > MAX_TRAZOS) invalid();
  let count = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const trazos = firma.trazos.map(trazo => {
    if (!Array.isArray(trazo) || trazo.length < 2) invalid();
    count += trazo.length;
    if (count > MAX_PUNTOS) invalid();
    return trazo.map(punto => {
      if (!Array.isArray(punto) || punto.length !== 2 ||
          !punto.every(Number.isFinite) || punto[0] < 0 || punto[0] > FIRMA_ANCHO ||
          punto[1] < 0 || punto[1] > FIRMA_ALTO) invalid();
      const x = Math.round(punto[0] * 10) / 10;
      const y = Math.round(punto[1] * 10) / 10;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      return [x, y];
    });
  });
  // No basta con recibir un objeto: debe existir al menos un trazo visible.
  const visible = trazos.some(trazo => trazo.some(([x, y]) =>
    Math.hypot(x - trazo[0][0], y - trazo[0][1]) >= 2));
  if (!visible || Math.hypot(maxX - minX, maxY - minY) < 2) {
    throw new Error('Dibuja tu firma antes de guardarla. El lienzo está vacío.');
  }
  return { ancho: FIRMA_ANCHO, alto: FIRMA_ALTO, trazos };
}
