import { AuthError, guardPermission } from './auth.mjs';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVOS = ['APROBADO', 'EN_ENTREGA', 'COMPLETADO', 'FINALIZADO', 'DEVUELTO'];
const fail = (status, code, message) => { throw new AuthError(status, code, message); };
const cents = value => Math.round(Number(value) * 100);
const cash = value => Math.round(Number(value) * 100) / 100;
const validId = value => typeof value === 'string' && UUID.test(value);

async function movementList(db, row) {
  const column = row.origen === 'PEDIDO' ? 'pedido_id' : 'contrato_id';
  const { rows } = await db.query(`SELECT id,monto,creado_en::text,metodo,referencia FROM pago
    WHERE ${column}=$1 AND tipo_movimiento=$2 AND proveedor_id IS NOT DISTINCT FROM $3::uuid
    ORDER BY creado_en,id`, [row.operacion_id, row.tipo_movimiento, row.proveedor_id || null]);
  const abonado = rows.reduce((sum, r) => sum + cents(r.monto), 0);
  return { ...row, total: cash(row.total), abonado: abonado / 100,
    saldo: (cents(row.total) - abonado) / 100,
    movimientos: rows.map(r => ({ ...r, monto: cash(r.monto) })) };
}

async function orderAccount(db, order, tipo, provider) {
  if (!ACTIVOS.includes(order.estado)) fail(409, 'ORDER_NOT_BILLABLE', 'El pedido debe estar aprobado y vigente para registrar movimientos.');
  let total = order.total;
  let bruto = null;
  let comision = null;
  let contraparte = order.cliente;
  if (tipo === 'PAGO_PROVEEDOR') {
    const result = await db.query(`SELECT SUM(subtotal) AS bruto,
      ROUND(SUM(subtotal)*(1-COALESCE(($3::jsonb->>'comision_proveedor')::numeric,0)/100),2) AS neto
      FROM pedido_item WHERE pedido_id=$1 AND proveedor_id=$2`, [order.id, provider, JSON.stringify(order.tasas)]);
    if (result.rows[0]?.bruto == null) fail(404, 'PROVIDER_ACCOUNT_NOT_FOUND', 'El proveedor no participa en este pedido.');
    const name = await db.query('SELECT nombre,empresa FROM usuario WHERE id=$1', [provider]);
    contraparte = name.rows[0]?.empresa || name.rows[0]?.nombre || 'Proveedor';
    bruto = cash(result.rows[0].bruto);
    total = cash(result.rows[0].neto);
    comision = cash(bruto - total);
    if (total < 0) fail(409, 'INVALID_COMMISSION', 'Revisa la comisión histórica del pedido.');
  } else if (order.es_empresa) {
    fail(409, 'INTERNAL_ORDER', 'Un alquiler de la empresa no genera un cobro contra la propia empresa.');
  }
  return movementList(db, { origen: 'PEDIDO', operacion_id: order.id, numero: `PED-${order.numero}`,
    tipo_movimiento: tipo, proveedor_id: provider || null, contraparte,
    es_empresa: order.es_empresa, bruto, comision, total });
}

async function contractAccount(db, contract) {
  if (contract.pedido_id) fail(409, 'CONTRACT_LINKED', 'Registra el cobro en el pedido vinculado para evitar duplicarlo.');
  return movementList(db, { origen: 'CONTRATO', operacion_id: contract.id,
    numero: `CON-${contract.id.slice(0, 8)}`, tipo_movimiento: 'COBRO_CLIENTE',
    proveedor_id: null, contraparte: contract.cliente, total: contract.total });
}

export async function readAccounts(db, user) {
  guardPermission({ user }, 'cuentas.consultar');
  const cobros = [], pagos = [];
  const values = [ACTIVOS];
  let scope = '';
  if (user.rol === 'empleado') scope = ' AND p.es_empresa';
  if (user.rol === 'proveedor') {
    values.push(user.id);
    scope = ' AND EXISTS (SELECT 1 FROM pedido_item i WHERE i.pedido_id=p.id AND i.proveedor_id=$2)';
  }
  const { rows: orders } = await db.query(`SELECT p.*,u.nombre AS cliente FROM pedido p
    JOIN usuario u ON u.id=p.cliente_id WHERE p.estado=ANY($1::varchar[])${scope} ORDER BY p.creado_en DESC,p.id`, values);
  for (const order of orders) {
    if (user.rol === 'admin' && !order.es_empresa) cobros.push(await orderAccount(db, order, 'COBRO_CLIENTE'));
    const { rows: providers } = await db.query(`SELECT DISTINCT proveedor_id FROM pedido_item
      WHERE pedido_id=$1 AND proveedor_id IS NOT NULL ${user.rol === 'proveedor' ? 'AND proveedor_id=$2' : ''}`,
    user.rol === 'proveedor' ? [order.id, user.id] : [order.id]);
    for (const provider of providers) pagos.push(await orderAccount(db, order, 'PAGO_PROVEEDOR', provider.proveedor_id));
  }
  if (user.rol === 'admin') {
    const { rows } = await db.query('SELECT id,cliente,total,pedido_id FROM contrato WHERE pedido_id IS NULL ORDER BY creado_en DESC,id');
    for (const contract of rows) cobros.push(await contractAccount(db, contract));
  }
  const sum = rows => ({ total: cash(rows.reduce((a,r) => a+cents(r.total),0)/100),
    abonado: cash(rows.reduce((a,r) => a+cents(r.abonado),0)/100), saldo: cash(rows.reduce((a,r) => a+cents(r.saldo),0)/100) });
  return { alcance: user.rol === 'proveedor' ? 'PROPIO' : user.rol === 'empleado' ? 'EMPRESA' : 'ADMINISTRACION',
    cobros, pagos, resumen: { cobros: sum(cobros), pagos: sum(pagos) } };
}

function validateMovement(body) {
  if (!body || typeof body !== 'object' || !validId(body.id) || !validId(body.operacion_id) ||
      !['PEDIDO','CONTRATO'].includes(body.origen) || !['COBRO_CLIENTE','PAGO_PROVEEDOR'].includes(body.tipo_movimiento)) {
    fail(400, 'VALIDATION_ERROR', 'Indica una operación, tipo de movimiento e identificador válidos.');
  }
  if (!/^[0-9]{1,10}(?:\.[0-9]{1,2})?$/.test(String(body.monto)) || cents(body.monto) <= 0) {
    fail(400, 'VALIDATION_ERROR', 'El monto debe ser positivo y tener máximo dos decimales.');
  }
  if (!['EFECTIVO','TRANSFERENCIA','CHEQUE'].includes(body.metodo) || typeof body.referencia !== 'string' ||
      !body.referencia.trim() || body.referencia.trim().length > 120 || /[\x00-\x1f\x7f]/.test(body.referencia)) {
    fail(400, 'VALIDATION_ERROR', 'Indica método y referencia del comprobante (máximo 120 caracteres).');
  }
  if (body.tipo_movimiento === 'PAGO_PROVEEDOR' ? !validId(body.proveedor_id) || body.origen !== 'PEDIDO' : body.proveedor_id != null) {
    fail(400, 'VALIDATION_ERROR', 'Revisa el proveedor y la clase de movimiento.');
  }
  return { ...body, id: body.id.toLowerCase(), operacion_id: body.operacion_id.toLowerCase(),
    proveedor_id: body.proveedor_id?.toLowerCase() || null, referencia: body.referencia.trim().toUpperCase(), monto: cents(body.monto)/100 };
}

export async function registerMovement(db, user, body) {
  guardPermission({ user }, 'cuentas.registrar');
  const input = validateMovement(body);
  return db.transaction(async tx => {
    const table = input.origen === 'PEDIDO' ? 'pedido' : 'contrato';
    const locked = await tx.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [input.operacion_id]);
    if (!locked.rows[0]) fail(404, 'ACCOUNT_NOT_FOUND', 'No se encontró la operación.');
    const existing = await tx.query('SELECT * FROM pago WHERE id=$1', [input.id]);
    if (existing.rows[0]) {
      const p = existing.rows[0];
      if (p.tipo_movimiento !== input.tipo_movimiento || p[`${table}_id`] !== input.operacion_id ||
          p.proveedor_id !== input.proveedor_id || cents(p.monto) !== cents(input.monto) ||
          p.metodo !== input.metodo || p.referencia !== input.referencia) {
        fail(409, 'PAYMENT_ID_CONFLICT', 'Este identificador ya corresponde a otro movimiento.');
      }
      return { replayed: true, id: p.id };
    }
    const account = table === 'pedido'
      ? await orderAccount(tx, locked.rows[0], input.tipo_movimiento, input.proveedor_id)
      : await contractAccount(tx, locked.rows[0]);
    if (input.tipo_movimiento !== account.tipo_movimiento || cents(input.monto) > cents(account.saldo)) {
      fail(409, 'PAYMENT_EXCEEDS_BALANCE', 'El movimiento supera el saldo pendiente o no corresponde a esta cuenta.');
    }
    const inserted = await tx.query(`INSERT INTO pago
      (id,contrato_id,pedido_id,tipo_movimiento,proveedor_id,monto,metodo,referencia,registrado_por)
      VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
    [input.id, table === 'contrato' ? input.operacion_id : null, table === 'pedido' ? input.operacion_id : null,
      input.tipo_movimiento,input.proveedor_id,input.monto.toFixed(2),input.metodo,input.referencia,user.id]);
    if (!inserted.rows[0]) fail(409, 'PAYMENT_ID_CONFLICT', 'El identificador o comprobante ya pertenece a otro movimiento.');
    await tx.query(`INSERT INTO auditoria(id,usuario_id,accion,entidad,entidad_id,detalle)
      VALUES ($1,$2,'cuenta.movimiento','pago',$3,$4::jsonb)`,
    [randomUUID(),user.id,input.id,JSON.stringify({ tipo: input.tipo_movimiento, operacion: input.operacion_id, monto: input.monto })]);
    return { replayed: false, id: input.id };
  });
}

export async function linkContract(db, user, body) {
  guardPermission({ user }, 'cuentas.registrar');
  if (!validId(body?.contrato_id) || !validId(body?.pedido_id)) fail(400,'VALIDATION_ERROR','Indica ambos identificadores.');
  return db.transaction(async tx => {
    const p = (await tx.query('SELECT * FROM pedido WHERE id=$1 FOR UPDATE',[body.pedido_id])).rows[0];
    const c = (await tx.query('SELECT * FROM contrato WHERE id=$1 FOR UPDATE',[body.contrato_id])).rows[0];
    if (!p || !c) fail(404,'ACCOUNT_NOT_FOUND','No se encontró el pedido o contrato.');
    if (p.es_empresa || p.tipo === 'COMPRA') fail(409,'INVALID_LINK','Vincula únicamente un contrato de renta de un cliente externo.');
    if (c.pedido_id === p.id) return { vinculado: true };
    if (c.pedido_id || (await tx.query('SELECT id FROM contrato WHERE pedido_id=$1',[p.id])).rows.length) fail(409,'INVALID_LINK','La operación ya tiene otra vinculación.');
    if ((await tx.query('SELECT id FROM pago WHERE contrato_id=$1 OR pedido_id=$2 LIMIT 1',[c.id,p.id])).rows.length) {
      fail(409,'ACCOUNT_HAS_MOVEMENTS','Vincula las operaciones antes de registrar movimientos. No se trasladan pagos históricos.');
    }
    await tx.query('UPDATE contrato SET pedido_id=$2 WHERE id=$1',[c.id,p.id]);
    await tx.query(`INSERT INTO auditoria(id,usuario_id,accion,entidad,entidad_id,detalle)
      VALUES (gen_random_uuid(),$1,'cuenta.vincular','contrato',$2,$3::jsonb)`,[user.id,c.id,JSON.stringify({ pedido_id:p.id })]);
    return { vinculado: true };
  });
}
