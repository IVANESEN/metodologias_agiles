import { readFile } from 'node:fs/promises';

const columns = { pedido: { es_empresa: 'boolean' }, contrato: { pedido_id: 'uuid' },
  pago: { tipo_movimiento: 'character varying(20)', pedido_id: 'uuid', proveedor_id: 'uuid',
    metodo: 'character varying(20)', referencia: 'character varying(120)', registrado_por: 'uuid' } };
const normalize = text => text.replace(/::text/g,'').replace(/[\s()]/g,'').toLowerCase();
const shape = normalize(`CHECK ((tipo_movimiento = 'COBRO_CLIENTE' AND proveedor_id IS NULL AND
  ((contrato_id IS NOT NULL AND pedido_id IS NULL) OR (contrato_id IS NULL AND pedido_id IS NOT NULL)))
  OR (tipo_movimiento = 'PAGO_PROVEEDOR' AND contrato_id IS NULL AND pedido_id IS NOT NULL AND proveedor_id IS NOT NULL))`);

export function cuentasPreparadas(inventory) {
  const table = name => inventory.appTables.find(t => t.name === name);
  const hasColumns = Object.entries(columns).every(([name, names]) => Object.entries(names).every(([column,type]) =>
    table(name)?.columns.some(c => c.name === column && c.type === type)));
  if (!hasColumns) return false;
  const fk = (from,column,to) => table(from).constraints.some(c => c.type === 'f' && c.validated &&
    c.columns.length === 1 && c.columns[0] === column && c.referenceTable === to &&
    c.referenceSchema === table(from).schema && c.referenceColumns[0] === 'id' && c.onDelete === 'r');
  return table('pedido').columns.some(c => c.name === 'es_empresa' && c.notNull && c.defaultValue === 'false') &&
    table('pago').columns.some(c => c.name === 'contrato_id' && !c.notNull) &&
    table('pago').columns.some(c => c.name === 'tipo_movimiento' && c.notNull && String(c.defaultValue).includes("'COBRO_CLIENTE'")) &&
    table('pago').constraints.some(c => c.name === 'pago_destino_check' && c.validated && normalize(c.definition) === shape) &&
    table('pago').constraints.some(c => c.name === 'pago_metodo_check' && c.validated &&
      [...c.definition.matchAll(/'([^']+)'/g)].map(m=>m[1]).sort().join(',') === 'CHEQUE,EFECTIVO,TRANSFERENCIA') &&
    [['pago','pedido_id','pedido'],['pago','proveedor_id','usuario'],['pago','registrado_por','usuario'],['contrato','pedido_id','pedido']].every(args=>fk(...args)) &&
    table('contrato').constraints.some(c=>c.type==='u' && c.columns.length===1 && c.columns[0]==='pedido_id');
}

export async function applyCuentasSchema(tx) {
  const { rows } = await tx.query(`SELECT 1 FROM pg_constraint WHERE conrelid='pago'::regclass AND conname='pago_destino_check'`);
  if (rows.length) return false;
  const sql = await readFile(new URL('../database/migrations/20261102_estados_cuenta.sql', import.meta.url), 'utf8');
  await tx.exec(sql);
  return true;
}

export async function migrateCuentas(database) {
  const { inspectPostgresDatabase, assertPostgresReady, PostgresPreparationError } = await import('./postgres-preparation.mjs');
  try {
    const verified = await database.verifyConnection();
    if (!(database.renderInternal && verified.privateNetwork) && !(verified.tls?.encrypted && verified.tls.authorized)) {
      throw new PostgresPreparationError('DATABASE_TLS_NOT_VERIFIED', 'La migración de cuentas requiere TLS verificado.');
    }
    if (database.schema !== 'constructora_private') throw new PostgresPreparationError('UNSUPPORTED_MIGRATION_SCHEMA', 'Revisa el esquema antes de migrar las cuentas.');
    await assertPostgresReady(database);
    const before = await inspectPostgresDatabase(database);
    if (cuentasPreparadas(before)) return { applied: false };
    return await database.transaction(async tx => {
      await tx.query("SELECT set_config('lock_timeout','10s',true)");
      await tx.query("SELECT set_config('statement_timeout','60s',true)");
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['constructora-init:constructora_private']);
      const scoped = { ...tx, schema: database.schema, requiresDataApiReview: database.requiresDataApiReview };
      await assertPostgresReady(scoped);
      const locked = await inspectPostgresDatabase(scoped);
      if (cuentasPreparadas(locked)) return { applied: false };
      if (Object.entries(columns).some(([name,names])=>locked.appTables.find(t=>t.name===name)?.columns.some(c=>Object.hasOwn(names,c.name)))) {
        throw new PostgresPreparationError('INCOMPATIBLE_EXISTING_TABLES','La ampliación de cuentas está incompleta o modificada; requiere revisión antes de migrar.');
      }
      const applied = await applyCuentasSchema(tx);
      await assertPostgresReady(scoped);
      if (!cuentasPreparadas(await inspectPostgresDatabase(scoped))) throw new Error('Incomplete migration');
      return { applied };
    });
  } catch (error) {
    if (error instanceof PostgresPreparationError) throw error;
    throw new PostgresPreparationError('DATABASE_MIGRATION_FAILED', 'No se pudo migrar el estado de cuenta. La transacción se revirtió; revisa la estructura antes de reintentar.');
  }
}
