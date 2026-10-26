// Datos de demostración del portal: cuentas de prueba, catálogo con fotografías
// y pedidos en distintos estados. Es idempotente: si la cuenta de administración
// ya existe no vuelve a insertar nada. Solo se guardan hashes de contraseñas.
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from './auth.mjs';
import { priceCart } from './portal.mjs';
import { hoyElSalvador } from './contratos-por-vencer.mjs';

export const CUENTAS_DEMO = Object.freeze([
  { clave: 'admin', correo: '2025-5714@esen.edu.sv', nombre: 'Administración ICI', rol: 'admin',
    empresa: 'ICI El Salvador', telefono: '2200-5714',
    hash: 'scrypt$65536$8$2$d72709ba45f8b1093cb2fbe3deaf2f4e$d816637bce84c1eaa043bd9b304021b7607ddf3be176baedf43070dce914854faa176d1938f3bba1abef2aae07fb93b48d8c0d97ccf16dc9bdef338b99aeb968' },
  { clave: 'empleado1', correo: '2025-5012@esen.edu.sv', nombre: 'Operaciones ICI 5012', rol: 'empleado',
    empresa: 'ICI El Salvador', telefono: '2200-5012',
    hash: 'scrypt$65536$8$2$28229fd2bacee4ad57f49c56efc2ca9b$2615abe1bb626c52b5a8916763fbbb9926a3df80901d6cc6df1505f5faf5e8c0d37327972c70afd6ee8cff6f2a3ff4163fca30ff6f8c87b05ea2db2a8fc8c70d' },
  { clave: 'empleado2', correo: '2025-5665@esen.edu.sv', nombre: 'Operaciones ICI 5665', rol: 'empleado',
    empresa: 'ICI El Salvador', telefono: '2200-5665',
    hash: 'scrypt$65536$8$2$25d49b701cb5ba46f742259e4bcb9837$776155b90c1fe44862e9fb128e129ace1ab49611c64ed33308bb43efee6d7e59bf3bed43da1419a7d155c17c696223a1929314af03456eab173ee84a462415ac' },
  { clave: 'proveedor', correo: '2024-5200@esen.edu.sv', nombre: 'Maquinaria Centroamericana', rol: 'proveedor',
    empresa: 'Maquinaria Centroamericana S.A. de C.V.', telefono: '2510-5200',
    hash: 'scrypt$65536$8$2$27cd79236bd1781d03a237a5c5c300d5$b0d56fb181842a9139a6506aeb0afa0f940797500ff399889de9ae444612a45b9a6b64d436d84bb3fa21bdb978081efd200d7b6d0097ee093cea9aad1d9e8ad7' },
  { clave: 'cliente', correo: '2024-5301@esen.edu.sv', nombre: 'Constructora Los Volcanes', rol: 'cliente',
    empresa: 'Constructora Los Volcanes S.A. de C.V.', telefono: '7890-5301',
    hash: 'scrypt$65536$8$2$9fe874f16bd10604793ae2bb7eb68d1b$f8538a2172d637ca7244e9ae1c3c1c4415080806a6973e7fdcf8d383ef583d186087bdec1634376e586e7eac55e865636ce0396e3a17f8f393a4a097f3940da2' },
]);

// Cuentas de relleno para que los tableros tengan historia. Su contraseña es
// aleatoria y nunca se imprime: no se usan para iniciar sesión.
const RELLENO = [
  { clave: 'pacifico', correo: 'compras@constructorapacifico.example', nombre: 'Constructora Pacífico', rol: 'cliente',
    empresa: 'Constructora Pacífico S.A. de C.V.', telefono: '2264-1180' },
  { clave: 'lempa', correo: 'proyectos@inversioneslempa.example', nombre: 'Inversiones Lempa', rol: 'cliente',
    empresa: 'Inversiones Lempa S.A.', telefono: '2661-4420' },
  { clave: 'istmo', correo: 'ventas@equiposdelistmo.example', nombre: 'Equipos del Istmo', rol: 'proveedor',
    empresa: 'Equipos del Istmo S.A. de C.V.', telefono: '2440-7788' },
];

const img = (name) => `/assets/img/maquinaria/${name}.jpg`;

const PRODUCTOS = [
  { id: 1, owner: null, nombre: 'Excavadora CAT 336', tipo: 'Excavadora', marca: 'Caterpillar', modelo: '336', anio: 2021,
    condicion: 'USADO', modalidad: 'RENTA', tarifa: 450, venta: null, stock: 1, horometro: 4820, ubicacion: 'San Salvador',
    sku: 'ICI-EXC-336', destacado: true, imagenes: [img('excavadora-cat-336'), img('excavadora-cat-336-b')],
    descripcion: 'Excavadora hidráulica de 36 toneladas para movimiento de tierra masivo, zanjeo profundo y carga de volquetes. Incluye mantenimiento preventivo al día y cucharón de uso general.',
    specs: { 'Potencia neta': '300 hp', 'Peso operativo': '36 000 kg', 'Profundidad máx. de excavación': '7.5 m', 'Capacidad del cucharón': '1.9 m³', 'Combustible': 'Diésel' } },
  { id: 2, owner: null, nombre: 'Retroexcavadora JCB 3CX', tipo: 'Retroexcavadora', marca: 'JCB', modelo: '3CX', anio: 2020,
    condicion: 'USADO', modalidad: 'RENTA', tarifa: 275, venta: null, stock: 1, horometro: 3950, ubicacion: 'Santa Ana',
    sku: 'ICI-RET-3CX', destacado: false, imagenes: [img('retroexcavadora-jcb-3cx'), img('retroexcavadora-jcb-3cx-b')],
    descripcion: 'Retroexcavadora versátil para excavación, carga y mantenimiento de obras urbanas. Tracción 4x4 y cargador frontal con cucharón 6 en 1.',
    specs: { 'Potencia': '92 hp', 'Peso operativo': '8 070 kg', 'Profundidad de excavación': '5.97 m', 'Tracción': '4x4' } },
  { id: 3, owner: null, nombre: 'Tractor de oruga CAT D6T', tipo: 'Tractor de oruga', marca: 'Caterpillar', modelo: 'D6T XW', anio: 2019,
    condicion: 'USADO', modalidad: 'RENTA', tarifa: 520, venta: null, stock: 1, horometro: 6210, ubicacion: 'La Libertad',
    sku: 'ICI-TRA-D6T', destacado: false, imagenes: [img('tractor-oruga-d6')],
    descripcion: 'Tractor de oruga con hoja semi-U y ripper para apertura de caminos, terracería y conformación de plataformas en terrenos difíciles.',
    specs: { 'Potencia': '215 hp', 'Peso operativo': '23 000 kg', 'Hoja': 'Semi-U 5.6 m³', 'Ripper': 'Multivástago' } },
  { id: 4, owner: 'proveedor', nombre: 'Cargador frontal CAT 950H', tipo: 'Cargador frontal', marca: 'Caterpillar', modelo: '950H', anio: 2018,
    condicion: 'REACONDICIONADO', modalidad: 'AMBAS', tarifa: 380, venta: 148000, stock: 1, horometro: 9120, ubicacion: 'San Miguel',
    sku: 'MCA-CF-950H', destacado: true, imagenes: [img('cargador-frontal-950')],
    descripcion: 'Cargador de ruedas reacondicionado en taller certificado: motor reparado, llantas nuevas al 90 % y sistema hidráulico revisado. Ideal para canteras y patios de agregados.',
    specs: { 'Potencia': '197 hp', 'Capacidad del cucharón': '3.3 m³', 'Peso operativo': '18 300 kg', 'Garantía': '6 meses en tren motriz' } },
  { id: 5, owner: 'proveedor', nombre: 'Rodo compactador CAT CS56', tipo: 'Compactador', marca: 'Caterpillar', modelo: 'CS56B', anio: 2022,
    condicion: 'USADO', modalidad: 'RENTA', tarifa: 240, venta: null, stock: 1, horometro: 1880, ubicacion: 'Sonsonate',
    sku: 'MCA-CMP-CS56', destacado: false, imagenes: [img('rodo-compactador')],
    descripcion: 'Compactador vibratorio de un tambor para bases, sub-bases y terraplenes. Doble amplitud y frecuencia para suelos granulares y cohesivos.',
    specs: { 'Ancho del tambor': '2.13 m', 'Peso operativo': '11 300 kg', 'Fuerza centrífuga': '266 kN', 'Velocidad máx.': '11 km/h' } },
  { id: 6, owner: null, nombre: 'Motoniveladora CAT 140H', tipo: 'Motoniveladora', marca: 'Caterpillar', modelo: '140H', anio: 2017,
    condicion: 'USADO', modalidad: 'RENTA', tarifa: 410, venta: null, stock: 1, horometro: 11040, ubicacion: 'Usulután',
    sku: 'ICI-MOT-140H', destacado: false, imagenes: [img('motoniveladora-140')],
    descripcion: 'Motoniveladora para perfilado de calles, cunetas y mantenimiento de caminos vecinales. Hoja de 3.7 m con control de pendiente.',
    specs: { 'Potencia': '185 hp', 'Longitud de la hoja': '3.7 m', 'Peso operativo': '15 300 kg' } },
  { id: 7, owner: 'proveedor', nombre: 'Camión de volteo MAN TGS 33.400', tipo: 'Camión de volteo', marca: 'MAN', modelo: 'TGS 33.400', anio: 2019,
    condicion: 'USADO', modalidad: 'AMBAS', tarifa: 210, venta: 96500, stock: 3, horometro: null, ubicacion: 'Santa Tecla',
    sku: 'MCA-VOL-TGS', destacado: false, imagenes: [img('camion-volteo')],
    descripcion: 'Camión de volteo 6x4 con caja de 14 m³ para acarreo de material selecto, ripio y desalojo. Documentación en regla y revisión técnica vigente.',
    specs: { 'Configuración': '6x4', 'Capacidad de caja': '14 m³', 'Potencia': '400 hp', 'Transmisión': 'Automatizada' } },
  { id: 8, owner: null, nombre: 'Grúa todo terreno Liebherr LTM 1500', tipo: 'Grúa', marca: 'Liebherr', modelo: 'LTM 1500-8.1', anio: 2016,
    condicion: 'USADO', modalidad: 'RENTA', tarifa: 1950, venta: null, stock: 1, horometro: 7400, ubicacion: 'San Salvador',
    sku: 'ICI-GRU-1500', destacado: true, imagenes: [img('grua-telescopica')],
    descripcion: 'Grúa telescópica de 500 toneladas para montaje de estructura metálica, torres y equipos industriales. Se renta con operador y rigger certificados.',
    specs: { 'Capacidad máxima': '500 t', 'Pluma telescópica': '84 m', 'Ejes': '8', 'Requiere': 'Plan de izaje aprobado' } },
  { id: 9, owner: 'proveedor', nombre: 'Minicargador CASE SR210', tipo: 'Minicargador', marca: 'CASE', modelo: 'SR210B', anio: 2025,
    condicion: 'NUEVO', modalidad: 'VENTA', tarifa: null, venta: 52900, stock: 3, horometro: 0, ubicacion: 'Soyapango',
    sku: 'MCA-MIN-SR210', destacado: true, imagenes: [img('minicargador')],
    descripcion: 'Minicargador nuevo con garantía de fábrica, ideal para demolición liviana, limpieza de obra y manejo de escombro. Compatible con accesorios de enganche rápido.',
    specs: { 'Potencia': '74 hp', 'Carga operativa': '952 kg', 'Garantía': '2 años o 2 000 h', 'Enganche': 'Universal' } },
  { id: 10, owner: 'proveedor', nombre: 'Manipulador telescópico JCB 540-170', tipo: 'Manipulador telescópico', marca: 'JCB', modelo: '540-170', anio: 2021,
    condicion: 'USADO', modalidad: 'AMBAS', tarifa: 260, venta: 118000, stock: 1, horometro: 2650, ubicacion: 'Apopa',
    sku: 'MCA-MAN-540', destacado: false, imagenes: [img('manipulador-telescopico')], estado: 'PENDIENTE',
    descripcion: 'Manipulador telescópico para izaje de materiales en edificios de hasta 5 niveles. Horquillas y plataforma de trabajo incluidas.',
    specs: { 'Altura de elevación': '17 m', 'Capacidad máxima': '4 000 kg', 'Tracción': '4x4' } },
  { id: 11, owner: 'istmo', nombre: 'Camión mezclador de concreto 8 m³', tipo: 'Mezcladora de concreto', marca: 'Volvo', modelo: 'FMX 8 m³', anio: 2020,
    condicion: 'USADO', modalidad: 'RENTA', tarifa: 330, venta: null, stock: 1, horometro: null, ubicacion: 'Santa Ana',
    sku: 'EDI-MIX-8M3', destacado: false, imagenes: [img('mezcladora-concreto')],
    descripcion: 'Camión mezclador de 8 m³ para colados en obra. Tambor con mantenimiento reciente y bomba de agua auxiliar.',
    specs: { 'Capacidad del tambor': '8 m³', 'Configuración': '6x4', 'Potencia': '380 hp' } },
];

function shiftDate(base, days) {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function loadDemoData(database, { logger = console } = {}) {
  const { rows } = await database.query('SELECT 1 FROM usuario WHERE correo = $1', [CUENTAS_DEMO[0].correo]);
  if (rows.length) return { loaded: false };
  const ids = {};
  await database.transaction(async (tx) => {
    for (const cuenta of CUENTAS_DEMO) {
      ids[cuenta.clave] = randomUUID();
      await tx.query(`INSERT INTO usuario (id, correo, nombre, clave_hash, rol, empresa, telefono)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (correo) DO NOTHING`,
      [ids[cuenta.clave], cuenta.correo, cuenta.nombre, cuenta.hash, cuenta.rol, cuenta.empresa, cuenta.telefono]);
    }
    for (const cuenta of RELLENO) {
      ids[cuenta.clave] = randomUUID();
      await tx.query(`INSERT INTO usuario (id, correo, nombre, clave_hash, rol, empresa, telefono)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (correo) DO NOTHING`,
      [ids[cuenta.clave], cuenta.correo, cuenta.nombre, await hashPassword(randomBytes(24).toString('base64url')),
        cuenta.rol, cuenta.empresa, cuenta.telefono]);
    }
    for (const p of PRODUCTOS) {
      const tarifa = p.tarifa ?? Math.max(1, Math.round(p.venta / 10) / 100);
      const values = [p.id, p.nombre, p.tipo, p.descripcion, tarifa.toFixed(2), p.ubicacion, p.horometro, p.marca, p.modelo,
        p.anio, p.condicion, p.modalidad, p.venta === null ? null : p.venta.toFixed(2), p.stock, p.sku, p.estado || 'ACTIVO',
        JSON.stringify(p.imagenes), JSON.stringify(p.specs), p.destacado, p.imagenes[0], p.owner ? ids[p.owner] : null];
      // Los equipos 1 y 2 vienen de la semilla original: se completa su ficha sin cambiar su identidad.
      await tx.query(`INSERT INTO maquinaria (id, nombre, tipo, descripcion, tarifa_diaria, ubicacion, horometro, marca, modelo,
          anio, condicion, modalidad, precio_venta, stock, sku, estado_publicacion, imagenes, especificaciones, destacado,
          foto_url, proveedor_id, disponible)
        VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10,$11,$12,$13::numeric,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,TRUE)
        ON CONFLICT (id) DO UPDATE SET nombre=EXCLUDED.nombre, marca=EXCLUDED.marca, modelo=EXCLUDED.modelo, anio=EXCLUDED.anio,
          condicion=EXCLUDED.condicion, horometro=COALESCE(maquinaria.horometro, EXCLUDED.horometro),
          ubicacion=COALESCE(maquinaria.ubicacion, EXCLUDED.ubicacion), sku=EXCLUDED.sku, imagenes=EXCLUDED.imagenes,
          especificaciones=EXCLUDED.especificaciones, destacado=EXCLUDED.destacado, foto_url=EXCLUDED.foto_url,
          descripcion=EXCLUDED.descripcion
        WHERE maquinaria.imagenes = '[]'::jsonb`, values);
    }
    const hoy = hoyElSalvador();
    const pedidos = [
      { cliente: 'cliente', estado: 'COMPLETADO', dias: -128, items: [{ maquinaria_id: 1, modalidad: 'RENTA', ini: -120, fin: -106 }] },
      { cliente: 'pacifico', estado: 'COMPLETADO', dias: -96, items: [{ maquinaria_id: 9, modalidad: 'COMPRA', cantidad: 1 }] },
      { cliente: 'lempa', estado: 'COMPLETADO', dias: -70, items: [{ maquinaria_id: 3, modalidad: 'RENTA', ini: -64, fin: -35, con_operador: true }] },
      { cliente: 'cliente', estado: 'COMPLETADO', dias: -44, items: [{ maquinaria_id: 5, modalidad: 'RENTA', ini: -40, fin: -31 },
        { maquinaria_id: 7, modalidad: 'COMPRA', cantidad: 1 }] },
      { cliente: 'pacifico', estado: 'CANCELADO', dias: -30, motivo: 'El cliente reprogramó la obra.', items: [{ maquinaria_id: 6, modalidad: 'RENTA', ini: -20, fin: -14 }] },
      { cliente: 'lempa', estado: 'COMPLETADO', dias: -21, items: [{ maquinaria_id: 11, modalidad: 'RENTA', ini: -18, fin: -12 }] },
      { cliente: 'cliente', estado: 'EN_ENTREGA', dias: -4, items: [{ maquinaria_id: 2, modalidad: 'RENTA', ini: -1, fin: 12, con_operador: true }] },
      { cliente: 'pacifico', estado: 'APROBADO', dias: -2, items: [{ maquinaria_id: 4, modalidad: 'RENTA', ini: 3, fin: 33 }] },
      { cliente: 'cliente', estado: 'PENDIENTE', dias: 0, items: [{ maquinaria_id: 8, modalidad: 'RENTA', ini: 5, fin: 7, con_operador: true }] },
      { cliente: 'lempa', estado: 'PENDIENTE', dias: 0, items: [{ maquinaria_id: 7, modalidad: 'COMPRA', cantidad: 1 }] },
    ];
    const flujo = ['PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO'];
    const notas = { PENDIENTE: 'Pedido recibido. Un asesor confirmará disponibilidad y entrega.',
      APROBADO: 'Disponibilidad confirmada. Preparando documentación y traslado.',
      EN_ENTREGA: 'El equipo salió del patio hacia la obra.', COMPLETADO: 'Entrega completada y recibida en obra.' };
    let numero = 1000;
    for (const pedido of pedidos) {
      numero += 1;
      const lines = pedido.items.map((item) => item.modalidad === 'RENTA'
        ? { maquinaria_id: item.maquinaria_id, modalidad: 'RENTA', cantidad: 1, con_operador: item.con_operador === true,
          fecha_inicio: shiftDate(hoy, item.ini), fecha_fin: shiftDate(hoy, item.fin), dias: item.fin - item.ini + 1 }
        : { maquinaria_id: item.maquinaria_id, modalidad: 'COMPRA', cantidad: item.cantidad, con_operador: false });
      const quote = await priceCart(tx, lines);
      const t = quote.totales;
      const id = randomUUID();
      const creado = `${shiftDate(hoy, pedido.dias)}T15:30:00Z`;
      const staff = ids[pedido.dias % 2 ? 'empleado1' : 'empleado2'];
      await tx.query(`INSERT INTO pedido (id, numero, cliente_id, tipo, estado, ciudad, direccion, metodo_pago, notas, subtotal,
          descuento, operador, flete, iva, deposito, total, tasas, atendido_por, motivo, creado_en, actualizado_en)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,
          $16::numeric,$17::jsonb,$18,$19,$20::timestamptz,$20::timestamptz)`,
      [id, numero, ids[pedido.cliente], quote.tipo, pedido.estado, 'San Salvador', 'Proyecto residencial, km 12 carretera al Puerto de La Libertad',
        'TRANSFERENCIA', null, t.subtotal.toFixed(2), t.descuento.toFixed(2), t.operador.toFixed(2), t.flete.toFixed(2),
        t.iva.toFixed(2), t.deposito.toFixed(2), t.total.toFixed(2), JSON.stringify(quote.tasas),
        pedido.estado === 'PENDIENTE' ? null : staff, pedido.motivo || null, creado]);
      for (const line of quote.items) {
        await tx.query(`INSERT INTO pedido_item (id, pedido_id, maquinaria_id, nombre, proveedor_id, modalidad, cantidad,
          fecha_inicio, fecha_fin, dias, con_operador, precio_unitario, subtotal)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12::numeric,$13::numeric)`,
        [randomUUID(), id, line.maquinaria_id, line.nombre, line.proveedor_id, line.modalidad, line.cantidad,
          line.fecha_inicio || null, line.fecha_fin || null, line.dias || null, line.con_operador,
          line.precio_unitario.toFixed(2), line.subtotal.toFixed(2)]);
        if (line.modalidad === 'COMPRA' && pedido.estado !== 'CANCELADO') {
          await tx.query('UPDATE maquinaria SET stock = stock - $2 WHERE id = $1', [line.maquinaria_id, line.cantidad]);
        }
      }
      const pasos = pedido.estado === 'CANCELADO' ? ['PENDIENTE', 'CANCELADO'] : flujo.slice(0, flujo.indexOf(pedido.estado) + 1);
      for (const [index, paso] of pasos.entries()) {
        await tx.query(`INSERT INTO pedido_evento (id, pedido_id, estado, nota, usuario_id, creado_en)
          VALUES ($1,$2,$3,$4,$5,$6::timestamptz + ($7 || ' hours')::interval)`,
        [randomUUID(), id, paso, paso === 'CANCELADO' ? pedido.motivo : notas[paso], index ? staff : ids[pedido.cliente],
          creado, String(index * 20)]);
      }
    }
    await tx.query(`INSERT INTO auditoria (id, usuario_id, accion, entidad, detalle) VALUES ($1, $2, 'demo.cargar', 'sistema', $3::jsonb)`,
      [randomUUID(), ids.admin, JSON.stringify({ productos: PRODUCTOS.length, pedidos: pedidos.length })]);
  });
  logger.info?.('Datos de demostración del portal cargados.');
  return { loaded: true };
}
