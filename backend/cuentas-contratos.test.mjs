import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createDatabase,initializeDatabase} from './database.mjs';
import {createServer,saveContract,savePayment,findPendingAccounts} from './app.mjs';
import {createUser} from './auth.mjs';
import {reconcileContract} from './cuentas.mjs';

test('El alquiler a proveedores es una obligación compartida, no un cobro a Constructora',async t=>{
  const db=await createDatabase({connectionString:'',dataDir:'memory://',production:false});
  await initializeDatabase(db);
  const server=createServer({database:db,requireAuth:true,secureCookies:false,logger:{}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();});
  const base=`http://127.0.0.1:${server.address().port}`,users={},cookies={};
  async function call(path,role,body){
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{
      ...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookies[role]?{Cookie:cookies[role]}:{})},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),headers:response.headers};
  }
  for(const rol of ['admin','empleado','proveedor','cliente']){
    users[rol]=await createUser(db,{nombre:rol,correo:`${rol}@contratos.example`,clave:'SoloPruebas2026',rol});
    const response=await call('/api/auth/login',rol,{correo:`${rol}@contratos.example`,clave:'SoloPruebas2026'});
    cookies[rol]=response.headers.get('set-cookie').split(';')[0];
  }
  users.otro=await createUser(db,{nombre:'Otro proveedor',correo:'otro@contratos.example',clave:'SoloPruebas2026',rol:'proveedor'});
  await db.query('UPDATE maquinaria SET proveedor_id=$1,tarifa_diaria=100 WHERE id=1',[users.proveedor.id]);
  await db.query('UPDATE maquinaria SET proveedor_id=$1,tarifa_diaria=60 WHERE id=2',[users.otro.id]);
  await db.query(`INSERT INTO maquinaria(id,nombre,tipo,descripcion,tarifa_diaria)
    VALUES(3,'Máquina propia','Excavadora','Equipo propio de pruebas',80)`);
  const create=(ids,start,end,days)=>saveContract(db,{maquinaria_ids:ids,cliente:'Constructora El Salvador',ciudad:'Santa Ana',
    fecha_inicio:start,fecha_fin:end,dias:days,operador:null,operador_documento:null,seguro:null,forma_pago:'TRANSFERENCIA',condiciones_especiales:null});
  const contract=await create([1,2],'2039-01-01','2039-01-02',2);
  const own=await create([3],'2039-01-01','2039-01-01',1);
  const legacyId=randomUUID();
  await db.query('INSERT INTO pago(id,contrato_id,monto) VALUES ($1,$2,40)',[legacyId,contract.id]);
  const legacy=(await db.query('SELECT id,monto,creado_en FROM pago WHERE id=$1',[legacyId])).rows[0];
  const accounts=async role=>(await call('/api/portal/cuentas',role)).data;
  const payment=(provider,amount)=>({id:randomUUID(),origen:'CONTRATO',operacion_id:contract.id,
    tipo_movimiento:'PAGO_PROVEEDOR',proveedor_id:provider,monto:String(amount),metodo:'TRANSFERENCIA',referencia:'REC-'+randomUUID()});
  const post=body=>call('/api/portal/cuentas/movimientos','admin',body);
  const reconcile=(body,role='admin')=>call('/api/portal/cuentas/conciliar',role,body);
  const assignment={contrato_id:contract.id,confirmar:true,asignaciones:[{pago_id:legacyId,proveedor_id:users.proveedor.id}]};

  await t.test('reparte por propietario y conserva el mismo importe en admin, empleado y proveedor',async()=>{
    const admin=await accounts('admin'),employee=await accounts('empleado'),provider=await accounts('proveedor');
    assert.deepEqual(admin.cobros.map(r=>r.operacion_id),[own.id]);
    assert.equal(admin.pagos.find(r=>r.proveedor_id===users.proveedor.id).total,200);
    assert.equal(admin.pagos.find(r=>r.proveedor_id===users.otro.id).total,120);
    assert.deepEqual(employee.pagos,admin.pagos);
    assert.equal(provider.pagos.length,1);assert.equal(provider.pagos[0].total,200);
    assert.equal(provider.pagos[0].contraparte,'Constructora El Salvador');
    assert.equal(provider.pagos[0].requiere_conciliacion,true);
    assert.equal(provider.conciliaciones.length,0);
    assert.ok(!JSON.stringify(provider).includes(users.otro.id));
    assert.equal(admin.conciliaciones[0].movimientos[0].id,legacyId);
    assert.equal(admin.pagos[0].abonado,0,'un cobro histórico no se supone un pago al proveedor');
  });
  await t.test('el propietario queda congelado y los equipos propios conservan su cobro externo',async()=>{
    await db.query('UPDATE maquinaria SET proveedor_id=$1 WHERE id=1',[users.otro.id]);
    await db.query('UPDATE maquinaria SET proveedor_id=$1 WHERE id=3',[users.proveedor.id]);
    assert.equal((await accounts('proveedor')).pagos[0].proveedor_id,users.proveedor.id);
    assert.deepEqual((await findPendingAccounts(db)).map(r=>r.id),[own.id]);
    await assert.rejects(savePayment(db,contract.id,{id:randomUUID(),monto:'1.00'}),{code:'SUPPLIER_CONTRACT'});
    assert.equal((await post({ ...payment(null,1),tipo_movimiento:'COBRO_CLIENTE'})).status,409);
    const next=await create([1],'2039-02-01','2039-02-01',1);
    assert.equal((await accounts('admin')).pagos.find(r=>r.operacion_id===next.id).proveedor_id,users.otro.id);
  });
  await t.test('impide otro pago antes de conciliar y exige permisos y asignación exacta',async()=>{
    const blocked=await post(payment(users.proveedor.id,1));assert.equal(blocked.status,409);
    assert.equal(blocked.data.error.code,'RECONCILIATION_REQUIRED');
    for(const role of ['proveedor','empleado','cliente'])assert.equal((await reconcile(assignment,role)).status,403);
    assert.equal((await reconcile({...assignment,confirmar:false})).status,400);
    assert.equal((await reconcile({...assignment,asignaciones:[...assignment.asignaciones,...assignment.asignaciones]})).status,400);
    assert.equal((await reconcile({...assignment,asignaciones:[{pago_id:randomUUID(),proveedor_id:users.proveedor.id}]})).status,409);
    assert.equal((await reconcile({...assignment,asignaciones:[{pago_id:legacyId,proveedor_id:randomUUID()}]})).status,404);
  });
  await t.test('confirmar un abono no crea otro pago y ambos perfiles ven el saldo actualizado',async()=>{
    const broken={transaction:fn=>db.transaction(tx=>fn({...tx,query:(sql,args)=>{
      if(sql.includes('INSERT INTO auditoria'))throw new Error('Auditoría no disponible');return tx.query(sql,args);
    }}))};
    await assert.rejects(reconcileContract(broken,users.admin,assignment),/Auditoría no disponible/);
    assert.equal((await db.query('SELECT tipo_movimiento FROM pago WHERE id=$1',[legacyId])).rows[0].tipo_movimiento,'COBRO_CLIENTE');
    assert.equal((await reconcile(assignment)).status,200);
    assert.deepEqual((await db.query('SELECT id,monto,creado_en FROM pago WHERE id=$1',[legacyId])).rows[0],legacy);
    const audit=(await db.query("SELECT detalle FROM auditoria WHERE accion='cuenta.conciliar'")).rows[0].detalle;
    assert.equal(audit.anteriores[0].tipo_movimiento,'COBRO_CLIENTE');
    assert.equal(audit.asignaciones[0].proveedor_id,users.proveedor.id);
    assert.equal((await reconcile(assignment)).status,409,'reintentar no vuelve a descontar el dinero');
    const input=payment(users.proveedor.id,70);
    assert.equal((await post(input)).status,200);assert.equal((await post(input)).data.replayed,true);
    const a=(await accounts('admin')).pagos.find(r=>r.operacion_id===contract.id && r.proveedor_id===users.proveedor.id);
    const p=(await accounts('proveedor')).pagos[0];
    for(const key of ['total','abonado','saldo','movimientos'])assert.deepEqual(a[key],p[key]);
    assert.equal(p.abonado,110);assert.equal(p.saldo,90);assert.equal(p.movimientos.length,2);
    assert.equal((await accounts('admin')).conciliaciones.length,0);
  });
  await t.test('dos pagos simultáneos no exceden el saldo de un proveedor y el SQL impide destinos mezclados',async()=>{
    const results=await Promise.all([post(payment(users.otro.id,100)),post(payment(users.otro.id,100))]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await post(payment(users.proveedor.id,91))).status,409);
    await assert.rejects(db.query(`INSERT INTO pago(id,contrato_id,monto,tipo_movimiento) VALUES($1,$2,1,'PAGO_PROVEEDOR')`,[randomUUID(),contract.id]));
    await assert.rejects(db.query(`INSERT INTO pago(id,contrato_id,pedido_id,monto,tipo_movimiento,proveedor_id)
      VALUES($1,$2,$3,1,'PAGO_PROVEEDOR',$4)`,[randomUUID(),contract.id,randomUUID(),users.proveedor.id]));
  });
});
