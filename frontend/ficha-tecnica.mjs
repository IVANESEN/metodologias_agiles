// HU5: cada ficha se construye exclusivamente con la maquinaria de su tarjeta.
// Se conserva 0 como lectura válida y se identifica explícitamente lo ausente.
export function createTechnicalSheet(item, document = globalThis.document) {
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const textOrMissing = value => typeof value === 'string' && value.trim() ? value.trim() : 'No disponible';
  const sheet = element('details');
  sheet.className = 'equipment-technical-sheet';
  sheet.dataset.maquinariaId = String(item.id);
  const title = element('summary', 'Ver ficha técnica');
  const content = element('div');
  content.className = 'technical-sheet-content';
  content.append(
    element('p', `Horómetro: ${Number.isInteger(item.horometro) && item.horometro >= 0 ? `${item.horometro} horas` : 'No disponible'}`),
    element('p', `Ficha técnica: ${textOrMissing(item.ficha_tecnica)}`),
  );
  if (typeof item.foto_url === 'string' && item.foto_url.trim()) {
    const photo = element('img');
    photo.src = item.foto_url;
    photo.alt = `Fotografía de ${item.nombre}`;
    photo.loading = 'lazy';
    photo.addEventListener('error', () => photo.replaceWith(element('p', 'Fotografía no disponible')));
    content.append(photo);
  } else {
    content.append(element('p', 'Fotografía no disponible'));
  }
  sheet.append(title, content);
  return sheet;
}
