import test from 'node:test';
import assert from 'node:assert/strict';
import { accountRows, accountsView } from '../frontend/assets/js/views/cuentas.js';

const row={numero:'PED-1001',origen:'PEDIDO',contraparte:'<script>nombre</script>',total:100,abonado:25,saldo:75,
 tipo_movimiento:'PAGO_PROVEEDOR',bruto:110,comision:10,movimientos:[{creado_en:'2026-11-02T12:00:00Z',monto:25,metodo:'TRANSFERENCIA',referencia:'<img src=x>'}]};
test('la vista escapa nombres y referencias y reserva los controles de pago al administrador',()=>{
 const provider=accountRows([row],false),admin=accountRows([row],true);
 assert.ok(provider.includes('&lt;script&gt;nombre'));assert.ok(!provider.includes('<script>'));
 assert.ok(provider.includes('&lt;img src=x&gt;'));assert.ok(!provider.includes('data-pay='));
 assert.ok(admin.includes('data-pay="0"'));assert.ok(admin.includes('Registrar pago'));
 assert.ok(!accountRows([{...row,saldo:0}],true).includes('data-pay='));
});
test('la vista de empleado presenta cuentas de empresa sin acciones administrativas',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({cobros:[],pagos:[row],resumen:{cobros:{total:0,abonado:0,saldo:0},pagos:{total:100,abonado:25,saldo:75}}})});
 try {
  const view={innerHTML:'',addEventListener(){}};
  await accountsView({view,user:{rol:'empleado'},can:()=>false,isCurrent:()=>true,setTitle(){}});
  assert.ok(view.innerHTML.includes('Constructora El Salvador'));
  assert.ok(view.innerHTML.includes('Cuentas por pagar'));assert.ok(!view.innerHTML.includes('data-pay='));
 }finally{globalThis.fetch=previous;}
});
