import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer, savePayment } from './app.mjs';
import { createUser } from './auth.mjs';
import { registerMovement } from './cuentas.mjs';
import { hoyElSalvador } from './contratos-por-vencer.mjs';

test('Estados de cuenta y alquileres compartidos de Constructora', async t => {
  const db = await createDatabase({ connectionString:'', dataDir:'memory://', production:false });
  await initializeDatabase(db);
  const server = createServer({ database:db, requireAuth:true, secureCookies:false, logger:{} });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{ server.closeAllConnections(); await new Promise(r=>server.close(r)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, role, body) {
    const r = await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookies[role]?{Cookie:cookies[role]}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return { status:r.status, data:await r.json(), headers:r.headers };
  }
  const users={},cookies={};
  for(const [key,rol] of [['admin','admin'],['empleado','empleado'],['colega','empleado'],['proveedor','proveedor'],['otro','proveedor'],['cliente','cliente']]) {
    users[key]=await createUser(db,{correo:`${key}@cuenta.example`,nombre:key,clave:'CuentaSegura2026',rol});
    const r=await call('/api/auth/login',key,{correo:`${key}@cuenta.example`,clave:'CuentaSegura2026'});
    assert.equal(r.status,200);cookies[key]=r.headers.get('set-cookie').split(';')[0];
  }
  await db.query('UPDATE maquinaria SET proveedor_id=$1 WHERE id=1',[users.proveedor.id]);
  await db.query('UPDATE maquinaria SET proveedor_id=$1 WHERE id=2',[users.otro.id]);
  function day(offset){ const d=new Date(hoyElSalvador()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10); }
  async function order(role,offset,machine=1,extra={}){
    const r=await call('/api/portal/pedidos/nuevo',role,{items:[{maquinaria_id:machine,modalidad:'RENTA',fecha_inicio:day(offset),fecha_fin:day(offset)}],ciudad:'Santa Ana',direccion:'Obra de pruebas número 10',metodo_pago:'TRANSFERENCIA',...extra});
    assert.equal(r.status,201,JSON.stringify(r.data));return r.data;
  }
  async function approve(o){assert.equal((await call(`/api/portal/pedidos/${o.id}/estado`,'empleado',{estado:'APROBADO'})).status,200);}
  const company=await order('empleado',20,1,{es_empresa:false});
  const external=await order('cliente',30,1,{es_empresa:true});
  const otherCompany=await order('colega',40,2);
  await t.test('el servidor identifica la empresa y todos sus empleados ven sus alquileres',async()=>{
    assert.equal(company.es_empresa,true);assert.equal(external.es_empresa,false);
    const r=await call('/api/portal/pedidos?empresa=true','colega');
    assert.deepEqual(new Set(r.data.map(o=>o.id)),new Set([company.id,otherCompany.id]));
    const client=await call('/api/portal/pedidos?empresa=true','cliente');assert.deepEqual(client.data.map(o=>o.id),[external.id]);
    assert.equal((await call('/api/portal/cuentas','empleado')).data.pagos.length,0,'un pedido pendiente todavía no es deuda');
  });
  await approve(company);await approve(external);await approve(otherCompany);
  let payout,collection;
  const movement=(row,amount,reference='COMPROBANTE-'+randomUUID())=>({id:randomUUID(),operacion_id:row.operacion_id,origen:row.origen,tipo_movimiento:row.tipo_movimiento,proveedor_id:row.proveedor_id,monto:String(amount),metodo:'TRANSFERENCIA',referencia:reference});
  const post=body=>call('/api/portal/cuentas/movimientos','admin',body);
  await t.test('admin separa cuentas y empleado consulta solo obligaciones de la empresa',async()=>{
    const a=(await call('/api/portal/cuentas','admin')).data;
    assert.equal(a.cobros.length,1);assert.equal(a.pagos.length,3);
    collection=a.cobros[0];payout=a.pagos.find(o=>o.operacion_id===company.id);
    assert.equal(collection.operacion_id,external.id);
    assert.equal(payout.bruto,450);assert.equal(payout.total,414);assert.equal(payout.comision,36);
    const e=(await call('/api/portal/cuentas','colega')).data;
    assert.equal(e.cobros.length,0);assert.deepEqual(new Set(e.pagos.map(o=>o.operacion_id)),new Set([company.id,otherCompany.id]));
  });
  await t.test('el proveedor solo obtiene sus operaciones sin movimientos de terceros',async()=>{
    const p=(await call('/api/portal/cuentas?proveedor_id='+users.otro.id,'proveedor')).data;
    assert.equal(p.cobros.length,0);assert.equal(p.pagos.length,2);
    assert.ok(p.pagos.every(o=>o.proveedor_id===users.proveedor.id));
    assert.ok(!JSON.stringify(p).includes(users.otro.id));
    for(const role of ['empleado','proveedor','cliente']) assert.equal((await call('/api/portal/cuentas/movimientos',role,movement(payout,10))).status,403);
    assert.equal((await call('/api/portal/cuentas','cliente')).status,403);
    assert.equal((await call('/api/portal/cuentas','anonimo')).status,401);
  });
  await t.test('abonos reales, comprobantes únicos e idempotencia conservan los saldos',async()=>{
    const body=movement(payout,100,'abono-uno');
    assert.equal((await post(body)).status,200);const replay=await post(body);assert.equal(replay.data.replayed,true);
    assert.equal((await post({...body,id:randomUUID()})).status,409);
    assert.equal((await post({...body,monto:'101'})).status,409);
    assert.equal((await post(movement(collection,50))).status,200);
    const a=(await call('/api/portal/cuentas','admin')).data;
    assert.equal(a.pagos.find(o=>o.operacion_id===company.id).saldo,314);
    assert.equal(a.cobros[0].abonado,50);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM auditoria WHERE accion=$1',['cuenta.movimiento'])).rows[0].n,2);
  });
  await t.test('validaciones de monto, destino y método impiden escrituras inválidas',async()=>{
    for(const monto of ['0','-5','0.001','NaN','1e3','100000000000000000000']) assert.equal((await post(movement(payout,monto))).status,400);
    assert.equal((await post(movement(payout,315))).status,409);
    assert.equal((await post({...movement(payout,1),proveedor_id:users.otro.id})).status,404);
    assert.equal((await post({...movement(payout,1),metodo:'CREDITO_30_DIAS'})).status,400);
    assert.equal((await post({...movement(payout,1),referencia:''})).status,400);
    assert.equal((await post({...movement(payout,1),operacion_id:randomUUID()})).status,404);
    assert.equal((await post(movement({...collection,operacion_id:company.id},1))).status,409);
  });
  await t.test('fallar la auditoría revierte el pago en la misma transacción',async()=>{
    const input=movement(payout,1);
    const broken={transaction:fn=>db.transaction(tx=>fn({...tx,query:(sql,args)=>{
      if(sql.includes('INSERT INTO auditoria'))throw new Error('Fallo controlado');return tx.query(sql,args);
    }}))};
    await assert.rejects(registerMovement(broken,users.admin,input),/Fallo controlado/);
    assert.equal((await db.query('SELECT id FROM pago WHERE id=$1',[input.id])).rows.length,0);
  });
  await t.test('dos solicitudes concurrentes no sobrepagan y los movimientos bloquean cancelación',async()=>{
    const responses=await Promise.all([post(movement(payout,200)),post(movement(payout,200))]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.equal((await call(`/api/portal/pedidos/${company.id}/estado`,'empleado',{estado:'CANCELADO'})).status,409);
  });
  await t.test('vincular un contrato elimina la deuda duplicada y protege el cobro antiguo',async()=>{
    const pending=await order('cliente',60);await approve(pending);
    const id=randomUUID();
    await db.query(`INSERT INTO contrato(id,maquinaria_id,maquinaria_nombre,cliente,fecha_inicio,fecha_fin,dias,tarifa_diaria,total)
      VALUES ($1,1,'Equipo','Cliente externo','2026-01-01','2026-01-01',1,100,100)`,[id]);
    assert.equal((await call('/api/portal/cuentas/vincular','admin',{pedido_id:external.id,contrato_id:id})).status,409,'operación cobrada no se vincula');
    assert.equal((await call('/api/portal/cuentas/vincular','empleado',{pedido_id:pending.id,contrato_id:id})).status,403);
    assert.equal((await call('/api/portal/cuentas/vincular','admin',{pedido_id:pending.id,contrato_id:id})).status,200);
    assert.ok(!(await call('/api/portal/cuentas','admin')).data.cobros.some(r=>r.origen==='CONTRATO'));
    assert.ok(!(await call('/api/cobros','admin')).data.some(r=>r.id===id));
    await assert.rejects(savePayment(db,id,{id:randomUUID(),monto:'1.00'}),{code:'CONTRACT_LINKED'});
    assert.equal((await post(movement({origen:'CONTRATO',operacion_id:id,tipo_movimiento:'COBRO_CLIENTE'},1))).status,409);
  });
  await t.test('las restricciones SQL rechazan mezclas de cobro y pago y conservan la estructura',async()=>{
    await assert.rejects(db.query(`INSERT INTO pago(id,pedido_id,monto,tipo_movimiento) VALUES ($1,$2,1,'PAGO_PROVEEDOR')`,[randomUUID(),company.id]));
    await assert.rejects(db.query(`INSERT INTO pago(id,pedido_id,proveedor_id,monto,tipo_movimiento) VALUES ($1,$2,$3,1,'COBRO_CLIENTE')`,[randomUUID(),external.id,users.proveedor.id]));
    const before=await db.query('SELECT * FROM pago ORDER BY id');await initializeDatabase(db,{seed:false});
    assert.deepEqual((await db.query('SELECT * FROM pago ORDER BY id')).rows,before.rows);
  });
});
