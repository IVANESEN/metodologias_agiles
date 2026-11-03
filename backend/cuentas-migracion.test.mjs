import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { migrateCuentas, cuentasPreparadas, migrateContratosProveedor, contratosProveedorPreparados } from './cuentas-migracion.mjs';
import { inspectPostgresDatabase, assertPostgresReady } from './postgres-preparation.mjs';

test('Migración de cuentas conserva historia y revierte DDL ante fallos',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const sql=await readFile(new URL('../database/schema.sql',import.meta.url),'utf8');
 await db.exec(`CREATE SCHEMA constructora_private;SET search_path TO constructora_private,pg_catalog;${sql}`);
 for(const row of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='constructora_private'")).rows) {
   await db.exec(`ALTER TABLE ${row.tablename} ENABLE ROW LEVEL SECURITY;REVOKE ALL ON ${row.tablename} FROM PUBLIC;`);
 }
 await db.exec(`INSERT INTO maquinaria(id,nombre,tipo,descripcion,tarifa_diaria) VALUES(1,'Máquina','Excavadora','Descripción',100);
 INSERT INTO contrato(id,maquinaria_id,maquinaria_nombre,cliente,fecha_inicio,fecha_fin,dias,tarifa_diaria,total)
 VALUES('00000000-0000-4000-8000-000000000001',1,'Máquina','Cliente','2026-01-01','2026-01-01',1,100,100);
 INSERT INTO pago(id,contrato_id,monto) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',25.50);`);
 const original=(await db.query('SELECT id,contrato_id,monto,creado_en FROM pago')).rows;
 // Solo se simula el transporte TLS; el SQL, restricciones y rollback son reales en PGlite aislado.
 function adapter(failAfterDdl=false){
   const wrap=tx=>({schema:'constructora_private',requiresDataApiReview:false,query:(q,p)=>tx.query(q,p),exec:async q=>{
     await tx.exec(q);if(failAfterDdl && q.includes('pago_destino_check'))throw new Error('Fallo tras DDL');
   }});
   return {...wrap(db),verifyConnection:async()=>({tls:{encrypted:true,authorized:true}}),transaction:fn=>db.transaction(tx=>fn(wrap(tx)))};
 }
 await t.test('revierte todas las columnas y conserva los pagos al fallar después del DDL',async()=>{
   await assert.rejects(migrateCuentas(adapter(true)),{code:'DATABASE_MIGRATION_FAILED'});
   assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='constructora_private' AND table_name='pago' AND column_name='pedido_id'")).rows.length,0);
   assert.deepEqual((await db.query('SELECT id,contrato_id,monto,creado_en FROM pago')).rows,original);
 });
 await t.test('aplica una vez, preserva saldo histórico y mantiene las 17 tablas privadas',async()=>{
   assert.deepEqual(await migrateCuentas(adapter()),{applied:true});
   const inv=await assertPostgresReady(adapter());
   assert.equal(cuentasPreparadas(inv),true);
   assert.equal(inv.appTables.length,17);assert.ok(inv.appTables.every(t=>t.rlsEnabled));
   assert.deepEqual((await db.query('SELECT id,contrato_id,monto,creado_en FROM pago')).rows,original);
   assert.equal((await db.query('SELECT tipo_movimiento FROM pago')).rows[0].tipo_movimiento,'COBRO_CLIENTE');
   const indexes=(await db.query("SELECT indexdef FROM pg_indexes WHERE schemaname='constructora_private' AND indexname='pago_comprobante_idx'")).rows;
   assert.match(indexes[0].indexdef,/UNIQUE INDEX/);
   assert.deepEqual(await migrateCuentas(adapter()),{applied:false});
 });
 await t.test('no acepta TLS sin verificar ni un destino diferente',async()=>{
   await assert.rejects(migrateCuentas({...adapter(),verifyConnection:async()=>({tls:{encrypted:false,authorized:false}})}),{code:'DATABASE_TLS_NOT_VERIFIED'});
   await assert.rejects(migrateCuentas({...adapter(),schema:'public'}),{code:'UNSUPPORTED_MIGRATION_SCHEMA'});
 });
 await t.test('proveedores revierte después del DDL real y migra una sola vez sin reclasificar pagos',async()=>{
   const provider='00000000-0000-4000-8000-000000000003';
   await db.query(`INSERT INTO usuario(id,correo,nombre,clave_hash,rol) VALUES($1,'proveedor@example.test','Proveedor','hash-local','proveedor')`,[provider]);
   await db.query('UPDATE maquinaria SET proveedor_id=$1 WHERE id=1',[provider]);
   await db.exec(`INSERT INTO contrato_maquinaria(contrato_id,maquinaria_id,maquinaria_nombre,tarifa_diaria)
     VALUES('00000000-0000-4000-8000-000000000001',1,'Máquina',100)`);
   await assert.rejects(migrateContratosProveedor(adapter(true)),{code:'DATABASE_MIGRATION_FAILED'});
   assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='constructora_private' AND table_name='contrato_maquinaria' AND column_name='proveedor_id'")).rows.length,0);
   assert.deepEqual((await db.query('SELECT id,contrato_id,monto,creado_en FROM pago')).rows,original);
   assert.deepEqual(await migrateContratosProveedor(adapter()),{applied:true});
   assert.equal(contratosProveedorPreparados(await assertPostgresReady(adapter())),true);
   assert.equal((await db.query('SELECT proveedor_id FROM contrato_maquinaria')).rows[0].proveedor_id,provider);
   assert.equal((await db.query('SELECT tipo_movimiento FROM pago')).rows[0].tipo_movimiento,'COBRO_CLIENTE');
   assert.deepEqual((await db.query('SELECT id,contrato_id,monto,creado_en FROM pago')).rows,original);
   await db.query('UPDATE maquinaria SET proveedor_id=NULL WHERE id=1');
   assert.deepEqual(await migrateContratosProveedor(adapter()),{applied:false});
   assert.equal((await db.query('SELECT proveedor_id FROM contrato_maquinaria')).rows[0].proveedor_id,provider);
   await assert.rejects(migrateContratosProveedor({...adapter(),verifyConnection:async()=>({tls:{encrypted:false,authorized:false}})}),{code:'DATABASE_TLS_NOT_VERIFIED'});
 });
 await t.test('detecta una ampliación incompleta sin intentar repararla automáticamente',async()=>{
   await db.exec('ALTER TABLE pago DROP CONSTRAINT pago_destino_check');
   assert.equal(cuentasPreparadas(await inspectPostgresDatabase(adapter())),false);
   await assert.rejects(migrateCuentas(adapter()));
   assert.deepEqual((await db.query('SELECT id,contrato_id,monto,creado_en FROM pago')).rows,original);
 });
});
