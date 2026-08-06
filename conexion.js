/* ============================================================
   AURA MINIPISCINAS — Conexión a Supabase (login + datos reales)
   Este archivo se carga DESPUÉS del sistema y reemplaza el login
   y el guardado para que todo quede en la base de datos.
   ============================================================ */

/* `persistSession:false` = la sesión vive solo mientras la pestaña está abierta.
   Al cerrarla o recargar hay que volver a poner usuario y contraseña, y no queda
   ningún token guardado en la computadora. Es a propósito: las máquinas del local
   las usa más de una persona y no puede pasar que el próximo entre con la sesión
   del anterior. NO activar la persistencia de sesión sin hablarlo. */
const SB = window.supabase.createClient(
  "https://dnamctecmutlmgblhnbg.supabase.co",
  "sb_publishable_GMWcvSFIPklV9e9PCb0c2g_GMKR_J-w",
  { auth: { persistSession: false, autoRefreshToken: true } }
);
/* Marca de que este archivo cargó: index.html la usa para avisar si falló. */
window.SISTEMA_CONECTADO = true;

/* ---- Cargar todos los datos desde la base al iniciar sesión ---- */
async function cargarTodo(){
  const [p,c,e,cat,v,vi,per] = await Promise.all([
    SB.from('productos').select('*').order('nombre'),
    SB.from('clientes').select('*').order('id'),
    SB.from('estados').select('*').order('orden'),
    SB.from('categorias').select('*').order('orden'),
    SB.from('ventas').select('*').order('id',{ascending:false}),
    SB.from('venta_items').select('*'),
    SB.from('perfiles').select('*').order('rol'),
  ]);
  const err = [p,c,e,cat,v,vi,per].find(r=>r.error);
  if(err) throw new Error(err.error.message);

  /* Tablas nuevas (resilientes: si todavía no corriste la migración SQL,
     no rompen el login; simplemente quedan vacías / con permisos por defecto). */
  let pagosData=[], audData=[], permData=[];
  try{ const r=await SB.from('pagos').select('*'); if(!r.error) pagosData=r.data||[]; }catch(_){}
  try{ const r=await SB.from('auditoria').select('*').order('creado',{ascending:false}).limit(1000); if(!r.error) audData=r.data||[]; }catch(_){}
  try{ const r=await SB.from('permisos').select('*'); if(!r.error) permData=r.data||[]; }catch(_){}

  PRODUCTOS.length=0; (p.data||[]).forEach(r=>PRODUCTOS.push({id:r.id,nombre:r.nombre,desc:r.descripcion||'',cat:r.categoria,precio:Number(r.precio),costo:Number(r.costo||0),stock:r.stock,descStock:r.descuenta_stock===true,activo:r.activo!==false}));
  CLIENTES.length=0; (c.data||[]).forEach(r=>CLIENTES.push({id:r.id,nombre:r.nombre,apellido:r.apellido,dni:r.dni,tel:r.telefono,mail:r.email,provincia:r.provincia,localidad:r.localidad,saldo:Number(r.saldo||0),activo:r.activo!==false}));
  ESTADOS.length=0; (e.data||[]).forEach(r=>ESTADOS.push({nombre:r.nombre,color:r.color||'gris'}));
  CATEGORIAS.length=0; (cat.data||[]).forEach(r=>CATEGORIAS.push(r.nombre));
  const pagosByV={}; pagosData.forEach(r=>{(pagosByV[r.venta_id]=pagosByV[r.venta_id]||[]).push({monto:Number(r.monto||0),metodo:r.metodo||'',fecha:r.fecha,usuario:r.usuario||''});});
  const byV={}; (vi.data||[]).forEach(r=>{(byV[r.venta_id]=byV[r.venta_id]||[]).push({nombre:r.nombre,precio:Number(r.precio),cant:r.cantidad,categoria:r.categoria});});
  VENTAS.length=0; (v.data||[]).forEach(r=>VENTAS.push({nro:r.id,cliente:r.cliente_nombre||'',localidad:r.localidad||'',provincia:r.provincia||'',total:Number(r.total),iva:Number(r.iva||0),factura:r.factura===true,saldo:Number(r.saldo||0),estado:r.estado,vendedor:r.vendedor||'',fecha:r.fecha,entrega:r.entrega||'',clienteId:r.cliente_id,cancelada:r.cancelada===true,nota:r.nota||'',items:byV[r.id]||[],pagos:pagosByV[r.id]||[]}));
  HISTORIAL.length=0; historialDesdeVentas(VENTAS).forEach(l=>HISTORIAL.push(l));
  USUARIOS.length=0; (per.data||[]).forEach(r=>USUARIOS.push({id:r.id,nombre:r.nombre||'',ap:r.apellido||'',user:r.usuario||'',rol:r.rol,activo:r.activo!==false,pass:'••••'}));
  AUDITORIA.length=0; audData.forEach(r=>AUDITORIA.push({usuario:r.usuario||'',rol:r.rol||'',accion:r.accion||'',entidad:r.entidad||'',entidad_id:r.entidad_id||'',detalle:r.detalle||'',creado:r.creado}));
  /* Permisos: arrancar de los valores por defecto y sobreescribir con lo guardado en la base. */
  PERMISOS = JSON.parse(JSON.stringify(PERMISOS_DEFAULT));
  permData.forEach(r=>{ if(!PERMISOS[r.rol]) PERMISOS[r.rol]={}; PERMISOS[r.rol][r.permiso]=r.permitido?1:0; });
}

/* ---- Auditoría: registra en memoria y persiste en la base ---- */
window.auditar = function(accion, entidad, entidadId, detalle){
  const reg={usuario:nombreUsuario(), rol:USUARIO_ACTUAL.rol, accion, entidad:entidad||'', entidad_id:entidadId!=null?String(entidadId):'', detalle:detalle||'', creado:new Date().toISOString()};
  AUDITORIA.unshift(reg);
  try{ SB.from('auditoria').insert({usuario:reg.usuario,rol:reg.rol,accion:reg.accion,entidad:reg.entidad,entidad_id:reg.entidad_id,detalle:reg.detalle}).then(()=>{}); }catch(_){}
};

/* ---- Persistencias auxiliares ---- */
/* El stock se guarda por una función de la base que toca SOLO esa columna:
   así el vendedor puede descontar stock al vender sin poder tocar precios.
   Si todavía no corriste `migracion_2026-08_seguridad.sql`, la función no
   existe y caemos al update directo de siempre. */
window.persistirStock = function(p){
  try{
    SB.rpc('aura_set_stock',{p_id:p.id, p_stock:String(p.stock)}).then(({error})=>{
      if(error) SB.from('productos').update({stock:String(p.stock)}).eq('id',p.id).then(()=>{});
    });
  }catch(_){}
};
window.persistirPermisos = async function(perm){
  try{
    const rows=[]; ROLES_CONFIG.forEach(r=>{ PERMISOS_LISTA.forEach(pp=>{ rows.push({rol:r,permiso:pp.k,permitido:!!(perm[r]&&perm[r][pp.k])}); }); });
    const res=await SB.from('permisos').upsert(rows,{onConflict:'rol,permiso'});
    if(res.error) toast("⚠️ Error guardando permisos: "+res.error.message);
  }catch(ex){ toast("⚠️ Error guardando permisos: "+ex.message); }
};

/* ---- Login real con Supabase Auth ---- */
window.ingresar = async function(){
  const raw=$("#logUser").value.trim();
  const email=raw.includes('@') ? raw.toLowerCase() : raw.toLowerCase().replace(/\s+/g,'-')+'@aura.local';
  const pass=$("#logPass").value;
  $("#logErr").style.color=""; $("#logErr").textContent="Ingresando…";
  const {data,error}=await SB.auth.signInWithPassword({email,password:pass});
  if(error){ $("#logErr").textContent="Usuario o contraseña incorrectos."; return; }
  const {data:perfil,error:pe}=await SB.from('perfiles').select('*').eq('id',data.user.id).single();
  if(pe||!perfil){ $("#logErr").textContent="Tu usuario no tiene perfil/rol asignado."; await SB.auth.signOut(); return; }
  if(perfil.activo===false){ $("#logErr").textContent="Usuario inactivo. Consultá con el Maestro."; await SB.auth.signOut(); return; }
  try{ await abrirApp(perfil); }catch(ex){ $("#logErr").textContent="Error cargando datos: "+ex.message; }
};

/* ---- Entrada a la app con un perfil ya validado (login o sesión guardada) ---- */
async function abrirApp(perfil){
  USUARIO_ACTUAL={nombre:perfil.nombre||'Usuario', ap:perfil.apellido||'', rol:perfil.rol};
  await cargarTodo();
  $("#logErr").textContent="";
  $("#loginScreen").style.display="none"; $("#appWrap").style.display="";
  actualizarTopbarUsuario();
  nav(tabsPermitidas()[0]);
}

window.salir = async function(){
  try{ await SB.auth.signOut(); }catch(e){}
  $("#appWrap").style.display="none"; $("#loginScreen").style.display="flex";
  $("#logPass").value=""; $("#logErr").textContent="";
  const u=$("#logUser"); if(u) u.focus();
};

/* ---- Guardado: NUEVA VENTA (+ ítems, IVA, pago inicial, stock) ---- */
/* Igual que el alta de cliente: sin esto, un doble clic en "Confirmar venta"
   cargaba la venta dos veces (y descontaba el stock dos veces). */
window.confirmarVenta = function(){ return unSoloGuardado('venta', '#btnConfirmarVenta', _confirmarVentaReal); };
async function _confirmarVentaReal(){
  if(!clienteActual){ toast("⚠️ Cargá el cliente primero"); return; }
  if(!carrito.length){ toast("⚠️ Agregá al menos un producto"); return; }
  /* Fecha y vendedor: para el vendedor común son siempre hoy y él mismo.
     El Maestro puede fecharla en el pasado y atribuirla a otro (carga histórica). */
  const carga=datosCargaHistorica();
  const errEnt=validarEntrega(carga);
  if(errEnt){ toast(errEnt); $("#vEntrega")?.focus(); return; }
  if(esMaestro() && $("#vVendedor")?.value==="__otro__" && !($("#vVendedorOtro")?.value||"").trim()){
    toast("⚠️ Escribí el nombre del vendedor"); $("#vVendedorOtro")?.focus(); return;
  }
  const c=clienteActual;
  const total=carrito.reduce((a,i)=>a+i.precio*i.cant,0);
  const iva=ventaFactura?total*IVA_PCT:0;
  const gran=total+iva;
  const cobrado=Math.max(0, Math.min(gran, +($("#vCobro").value||0)));
  const metodo=($("#vPago")?.value||"Efectivo");
  const entrega=($("#vEntrega")?.value||"")||null;
  const nota=($("#vNota")?.value||"").trim();
  const remito=$("#vRemito").checked;
  const {data,error}=await SB.from('ventas').insert({
    cliente_id:c.id, cliente_nombre:`${c.nombre} ${c.apellido}`, vendedor:carga.vendedor,
    fecha:carga.fecha, entrega, total, iva, factura:ventaFactura, saldo:gran-cobrado,
    estado:"Procesando pedido", provincia:c.provincia, localidad:`${c.localidad} (${c.provincia})`, nota
  }).select().single();
  if(error){ toast("⚠️ Error al guardar la venta: "+error.message); return; }
  const nro=data.id;
  const items=carrito.map(i=>({venta_id:nro,nombre:i.nombre,precio:i.precio,cantidad:i.cant,categoria:(PRODUCTOS.find(p=>p.id===i.id)||{}).cat||null}));
  if(items.length){ const r=await SB.from('venta_items').insert(items); if(r.error){ toast("⚠️ Venta guardada, pero error en ítems: "+r.error.message); } }
  // Pago inicial registrado
  let pagos=[];
  if(cobrado>0){ pagos=[{monto:cobrado,metodo,fecha:data.fecha,usuario:carga.vendedor}];
    try{ await SB.from('pagos').insert({venta_id:nro,monto:cobrado,metodo,fecha:data.fecha,usuario:carga.vendedor}); }catch(_){} }
  /* Descuento de stock automático. En una carga histórica NO se descuenta: esa
     mercadería salió hace meses y el stock de hoy ya lo refleja; descontarla de
     nuevo dejaría el número por debajo de lo real. */
  if(!carga.historica) descontarStockVenta(carrito);
  // Envío automático del remito por mail (no bloquea la pantalla).
  // El servidor arma el remito con los datos de la base a partir del número de venta.
  if(remito && c.mail){
    enviarRemito({nro}).catch(e=>console.warn('Remito mail:',e));
  }
  VENTAS.unshift({nro,cliente:`${c.nombre} ${c.apellido}`,localidad:`${c.localidad} (${c.provincia})`,provincia:c.provincia,total,iva,factura:ventaFactura,saldo:gran-cobrado,estado:"Procesando pedido",vendedor:carga.vendedor,fecha:data.fecha,entrega:entrega||"",clienteId:c.id,cancelada:false,nota,pagos,items:carrito.map(i=>({nombre:i.nombre,precio:i.precio,cant:i.cant,categoria:(PRODUCTOS.find(p=>p.id===i.id)||{}).cat}))});
  /* La auditoría registra quién la cargó (nombreUsuario) y, si es histórica,
     a quién se le atribuyó y con qué fecha. */
  auditar(carga.historica?"Venta cargada (histórica)":"Venta creada","venta",nro,
    `Cliente ${c.nombre} ${c.apellido} · Total ${money(gran)}${ventaFactura?' (c/IVA)':''}`+
    (carga.historica?` · fecha ${fmtFechaCorta(carga.fecha)} · vendedor ${carga.vendedor}`:''));
  toast(`✅ Venta #${nro} guardada`+(carga.historica?` · ${fmtFechaCorta(carga.fecha)} · ${carga.vendedor}`:'')+(remito&&c.mail?` · remito a ${c.mail}`:""));
  respaldarEnSheet(nro);
  nav("ventas");
}

/* ---- Guardado: EDICIÓN DE VENTA (persiste lo que cambió la pantalla) ----
   OJO con los permisos: cuando la base rechaza una edición por RLS no devuelve
   error, simplemente no toca ninguna fila. Por eso pedimos siempre las filas
   afectadas (.select) y, si vuelven vacías, cortamos ANTES de insertar los
   ítems nuevos y dejamos la venta como estaba. Sin esto, cada intento fallido
   sumaba una copia de los productos y la venta terminaba con todo duplicado. */
const _guardarEdicionVenta = window.guardarEdicionVenta;
window.guardarEdicionVenta = function(nro){
  const nuevos = (editDraft && editDraft.nuevosPagos) ? editDraft.nuevosPagos.slice() : [];
  const vAntes = VENTAS.find(x=>x.nro===nro);
  const copiaPrevia = vAntes ? JSON.parse(JSON.stringify(vAntes)) : null;
  const ok = _guardarEdicionVenta(nro);   // actualiza memoria + audita + cierra modal
  if(!ok) return false;
  const v = VENTAS.find(x=>x.nro===nro); if(!v) return true;
  (async()=>{
    try{
      const r1=await SB.from('ventas').update({total:v.total, iva:v.iva, factura:v.factura, saldo:v.saldo, nota:v.nota}).eq('id',nro).select('id');
      if(r1.error) throw r1.error;
      if(!r1.data || !r1.data.length) throw new Error("no tenés permiso para editar esta venta");
      /* Primero insertamos los ítems nuevos y recién después borramos los viejos:
         si el insert falla, la venta no se queda sin productos. */
      const {data:itemsViejos}=await SB.from('venta_items').select('id').eq('venta_id',nro);
      if(v.items.length){ const r2=await SB.from('venta_items').insert(v.items.map(i=>({venta_id:nro,nombre:i.nombre,precio:i.precio,cantidad:i.cant,categoria:i.categoria||null}))); if(r2.error) throw r2.error; }
      if(itemsViejos && itemsViejos.length){
        const rd=await SB.from('venta_items').delete().in('id',itemsViejos.map(x=>x.id)).select('id');
        if(rd.error) throw rd.error;
        if(!rd.data || rd.data.length!==itemsViejos.length){
          toast("⚠️ La venta #"+nro+" quedó con productos repetidos. Avisá al administrador.");
        }
      }
      if(nuevos.length){ const r3=await SB.from('pagos').insert(nuevos.map(pp=>({venta_id:nro,monto:pp.monto,metodo:pp.metodo,fecha:pp.fecha,usuario:pp.usuario}))); if(r3.error) throw r3.error; }
      respaldarEnSheet(nro);
    }catch(ex){
      /* No se guardó: dejamos la venta como estaba para que la pantalla no mienta. */
      if(copiaPrevia){ Object.assign(v, copiaPrevia); renderTablaVentas(); }
      toast("⚠️ No se pudo guardar la venta #"+nro+": "+(ex.message||ex));
    }
  })();
  return true;
};

/* ---- Copia de seguridad en la planilla de Google ----
   Se dispara sola cada vez que una venta se crea, se edita, se cobra o se
   cancela. Mandamos solo el número: el servidor arma la fila leyendo la base.
   No molesta al vendedor si falla (queda anotado en la consola) porque la
   venta ya quedó guardada igual; la planilla es una copia, no el original. */
async function respaldarEnSheet(nro){
  try{
    const {data:{session}} = await SB.auth.getSession();
    const r = await fetch('/api/backup-sheet',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?session.access_token:'')},
      body: JSON.stringify({nro})
    });
    const j = await r.json();
    if(j.sinConfigurar) return;                       // todavía no se conectó la planilla
    if(!j.ok) console.warn('Copia en la planilla:', j.error||'no se pudo guardar');
  }catch(ex){ console.warn('Copia en la planilla:', ex.message||ex); }
}

/* ---- Envío de correos al cliente ----
   Solo mandamos el número de venta: el servidor resuelve el destinatario y los
   importes contra la base. `soloRemito` manda únicamente el comprobante;
   sin esa marca se adjunta también el manual de usuario. */
async function enviarRemito({nro, soloRemito, tipo}){
  const {data:{session}}=await SB.auth.getSession();
  const r=await fetch('/api/enviar-remito',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?session.access_token:'')},
    body:JSON.stringify({nro, soloRemito:!!soloRemito, tipo})
  });
  let j={}; try{ j=await r.json(); }catch(_){}
  if(!r.ok||!j.ok) throw new Error(j.error||'No se pudo enviar el correo');
  return j;
}

async function _enviarRemitoVenta(nro, completo){
  const v=VENTAS.find(x=>x.nro===nro); if(!v){ toast("Venta no encontrada"); return; }
  const c=CLIENTES.find(x=>x.id===v.clienteId)||{};
  if(!c.mail){ toast("⚠️ El cliente no tiene email cargado"); return; }
  toast("Enviando…");
  try{
    const j=await enviarRemito({nro, soloRemito:!completo});
    auditar(completo?"Correo completo reenviado":"Comprobante reenviado","venta",nro,j.email||c.mail);
    toast("✅ Enviado a "+(j.email||c.mail));
  }catch(ex){ toast("⚠️ "+(ex.message||'Error de conexión al enviar el correo')); }
}
window.reenviarComprobante = function(nro){ cerrarModal(); _enviarRemitoVenta(nro,false); };
window.reenviarCorreoCompleto = function(nro){ cerrarModal(); _enviarRemitoVenta(nro,true); };

/* ---- Guardado: CLIENTE (alta/edición) ---- */
/* Un guardado tarda lo que tarda la base en contestar (varias décimas de
   segundo). En ese rato el botón seguía activo: si se apretaba otra vez —o el
   mouse mandaba un doble clic— salían dos altas iguales y el cliente quedaba
   cargado dos veces. Esto deja pasar solo la primera y bloquea el botón hasta
   que termina. */
const _guardadoEnCurso = {};
async function unSoloGuardado(clave, selectorBoton, tarea){
  if(_guardadoEnCurso[clave]) return;          // ya hay uno en camino: ignoramos el clic
  _guardadoEnCurso[clave] = true;
  const btn = selectorBoton ? document.querySelector(selectorBoton) : null;
  const textoOriginal = btn ? btn.textContent : null;
  if(btn){ btn.disabled = true; btn.style.opacity = "0.65"; btn.style.cursor = "wait"; btn.textContent = "Guardando…"; }
  try{ return await tarea(); }
  finally{
    _guardadoEnCurso[clave] = false;
    if(btn && document.body.contains(btn)){ btn.disabled=false; btn.style.opacity=""; btn.style.cursor=""; btn.textContent=textoOriginal; }
  }
}

window.guardarCliente = function(){ return unSoloGuardado('cliente', '#btnGuardarCliente', _guardarClienteReal); };
async function _guardarClienteReal(){
  const campos={nombre:$("#cNombre"),apellido:$("#cApellido"),dni:$("#cDni"),tel:$("#cTel"),provincia:$("#cProvincia"),localidad:$("#cLocalidad"),mail:$("#cMail")};
  let faltan=false; Object.values(campos).forEach(el=>{const v=!el.value.trim(); el.classList.toggle("err",v); if(v)faltan=true;});
  if(faltan){ toast("⚠️ Completá todos los campos obligatorios (*)"); return; }
  const mail=campos.mail.value.trim();
  if(!/^\S+@\S+\.\S+$/.test(mail)){ campos.mail.classList.add("err"); toast("⚠️ Revisá el email del cliente"); return; }
  const datos={nombre:campos.nombre.value.trim(),apellido:campos.apellido.value.trim(),dni:campos.dni.value.trim(),tel:campos.tel.value.trim(),provincia:campos.provincia.value,localidad:campos.localidad.value.trim(),mail};
  const fila={nombre:datos.nombre,apellido:datos.apellido,dni:datos.dni,telefono:datos.tel,email:datos.mail,provincia:datos.provincia,localidad:datos.localidad};
  const editId = (modalModo==="venta" && clienteActual) ? clienteActual.id
               : (typeof clienteEditId!=="undefined" && clienteEditId!=null) ? clienteEditId : null;

  /* El DNI no se puede repetir: es lo que identifica a una persona. Si ya hay
     otra ficha con ese documento, avisamos quién es en vez de dejar que se
     cargue un cliente duplicado (o que se le ponga a uno el DNI de otro).
     Comparamos solo los números, así "20.123.456" y "20123456" son el mismo. */
  const soloNumeros = t => String(t||'').replace(/\D/g,'');
  const dniNuevo = soloNumeros(datos.dni);
  if(dniNuevo){
    const repetido = CLIENTES.find(x => x.id!==editId && soloNumeros(x.dni)===dniNuevo);
    if(repetido){
      campos.dni.classList.add("err"); campos.dni.focus();
      toast(`⚠️ El DNI ${datos.dni} ya está cargado en el cliente ${repetido.nombre} ${repetido.apellido||''}`.trim());
      return;
    }
  }
  if(editId!=null){
    const r=await SB.from('clientes').update(fila).eq('id',editId); if(r.error){ toast("⚠️ Error: "+r.error.message); return; }
    if(modalModo==="venta" && clienteActual) Object.assign(clienteActual,datos);
    const reg=CLIENTES.find(x=>x.id===editId); if(reg) Object.assign(reg,{nombre:datos.nombre,apellido:datos.apellido,dni:datos.dni,tel:datos.tel,mail:datos.mail,provincia:datos.provincia,localidad:datos.localidad});
  } else {
    const {data,error}=await SB.from('clientes').insert(fila).select().single(); if(error){ toast("⚠️ Error al guardar el cliente: "+error.message); return; }
    const id=data.id;
    CLIENTES.push({id,nombre:datos.nombre,apellido:datos.apellido,dni:datos.dni,tel:datos.tel,mail:datos.mail,provincia:datos.provincia,localidad:datos.localidad,saldo:0,activo:true});
    if(modalModo==="venta") clienteActual={id,...datos};
  }
  cerrarModal();
  if(modalModo==="venta"){ renderClienteBox(); toast("✅ Cliente guardado"); } else { viewClientes(); toast("✅ Cliente guardado"); }
}

/* ---- Guardado: PRODUCTO (alta/edición, con costo y descuento de stock) ---- */
window.guardarProducto = async function(id){
  const nombre=$("#pNombre").value.trim(), cat=$("#pCat").value, precioRaw=$("#pPrecio").value, desc=$("#pDesc").value.trim(), stockRaw=$("#pStock").value.trim();
  const costoRaw=$("#pCosto").value, descStock=$("#pDescStock").value==='si';
  let falta=false; [["pNombre",!nombre],["pCat",!cat],["pPrecio",precioRaw===""||isNaN(+precioRaw)]].forEach(([i,b])=>{$("#"+i).classList.toggle("err",b); if(b)falta=true;});
  if(falta){ toast("⚠️ Completá nombre, categoría y un precio válido"); return; }
  const precio=+precioRaw;
  const costo=(costoRaw===""||isNaN(+costoRaw))?0:+costoRaw;
  const stock=stockRaw===""?"No Desc":stockRaw;
  const fila={nombre,descripcion:desc,categoria:cat,precio,costo,stock:String(stock),descuenta_stock:descStock};
  if(id!=null){ const r=await SB.from('productos').update(fila).eq('id',id); if(r.error){ toast("⚠️ Error: "+r.error.message); return; } Object.assign(PRODUCTOS.find(x=>x.id===id),{nombre,desc,cat,precio,costo,stock,descStock}); auditar("Producto modificado","producto",id,nombre); }
  else { const {data,error}=await SB.from('productos').insert({...fila,activo:true}).select().single(); if(error){ toast("⚠️ Error: "+error.message); return; } PRODUCTOS.push({id:data.id,nombre,desc,cat,precio,costo,stock,descStock,activo:true}); auditar("Producto creado","producto",data.id,nombre); }
  cerrarModal(); viewProductos(); toast("✅ Producto guardado");
};

/* ---- Activar/Inactivar y cambios de estado (envuelven la función original) ----
   Todas usan guardarCampo(): si la base rechaza el cambio por permisos, no
   devuelve error pero tampoco toca ninguna fila, así que hay que mirar las
   filas afectadas y avisar. Antes esto se perdía en silencio y la pantalla
   mostraba un cambio que en realidad nunca se guardó. */
async function guardarCampo(tabla, id, campos, queEs){
  try{
    const r=await SB.from(tabla).update(campos).eq('id',id).select('id');
    if(r.error) throw r.error;
    if(!r.data || !r.data.length) throw new Error("no tenés permiso");
    return true;
  }catch(ex){
    toast("⚠️ No se pudo guardar "+queEs+": "+(ex.message||ex)+". Volvé a entrar para ver los datos reales.");
    return false;
  }
}

const _toggleProducto=window.toggleProducto;
window.toggleProducto=function(id){ _toggleProducto(id); const p=PRODUCTOS.find(x=>x.id===id); if(p) guardarCampo('productos',id,{activo:p.activo},"el producto"); };

const _toggleCliente=window.toggleCliente;
window.toggleCliente=function(id){ _toggleCliente(id); const c=CLIENTES.find(x=>x.id===id); if(c) guardarCampo('clientes',id,{activo:c.activo},"el cliente"); };

const _guardarEstadoVenta=window.guardarEstadoVenta;
window.guardarEstadoVenta=function(nro){ _guardarEstadoVenta(nro); const v=VENTAS.find(x=>x.nro===nro); if(v) guardarCampo('ventas',nro,{estado:v.estado},"el estado de la venta #"+nro); };

const _confirmarCancelarVenta=window.confirmarCancelarVenta;
window.confirmarCancelarVenta=function(nro){
  _confirmarCancelarVenta(nro);
  guardarCampo('ventas',nro,{cancelada:true},"la cancelación de la venta #"+nro).then(ok=>{
    /* Si no se pudo cancelar en la base, deshacemos en pantalla: si no, los
       reportes y el listado mostrarían como cancelada una venta que sigue viva. */
    if(!ok){ const v=VENTAS.find(x=>x.nro===nro); if(v){ v.cancelada=false; renderTablaVentas(); } }
    else respaldarEnSheet(nro);
  });
};

/* ---- Catálogos (reemplazan la lista completa en la base) ---- */
const _guardarEstados=window.guardarEstados;
window.guardarEstados=async function(){ _guardarEstados(); try{ await SB.from('estados').delete().neq('id',-1); await SB.from('estados').insert(ESTADOS.map((e,i)=>({nombre:e.nombre,color:e.color,orden:i+1}))); }catch(ex){ toast("⚠️ Error guardando estados: "+ex.message); } };

const _guardarCategorias=window.guardarCategorias;
window.guardarCategorias=async function(){ _guardarCategorias(); try{ await SB.from('categorias').delete().neq('id',-1); await SB.from('categorias').insert(CATEGORIAS.map((c,i)=>({nombre:c,orden:i+1}))); }catch(ex){ toast("⚠️ Error guardando categorías: "+ex.message); } };

/* ---- Usuarios: perfil, rol, estado y contraseña ----
   `perfiles` es de solo lectura desde el navegador y las contraseñas viven en
   Supabase Auth: todo esto pasa por las funciones de servidor, que validan
   Maestro y usan la clave secreta. */
async function apiUsuarios(ruta, payload){
  const { data:{ session } } = await SB.auth.getSession();
  const r = await fetch(ruta, {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?session.access_token:'')},
    body: JSON.stringify(payload)
  });
  let j={}; try{ j=await r.json(); }catch(_){}
  if(!r.ok || !j.ok) throw new Error(j.error || 'No se pudo completar la operación');
  return j;
}

const _toggleUsuario=window.toggleUsuario;
window.toggleUsuario=async function(i){
  if(!puede('gestionar_usuarios')){ toast("No tenés permiso para gestionar usuarios"); return; }
  const u=USUARIOS[i]; if(!u) return;
  if(!u.id){ toast("⚠️ Este usuario todavía no existe en la base"); return; }
  try{ await apiUsuarios('/api/editar-usuario', {id:u.id, activo:!u.activo}); }
  catch(ex){ toast("⚠️ No se pudo guardar: "+ex.message); return; }
  _toggleUsuario(i);   // la pantalla se actualiza recién cuando la base confirmó
};

window.guardarUsuario=async function(i){
  const nombre=$("#uNombre").value.trim(), ap=$("#uAp").value.trim(), user=$("#uUser").value.trim(), rol=$("#uRol").value, activo=$("#uActivo").value==="1";
  if(!nombre||!ap||!user){ toast("⚠️ Completá nombre, apellido y usuario"); return; }
  if(i!=null){
    const u=USUARIOS[i];
    if(!u.id){ toast("⚠️ Este usuario todavía no existe en la base"); return; }
    const pass=$("#uPass").value;
    if(pass && pass.length<6){ $("#uPass").classList.add("err"); toast("⚠️ La contraseña tiene que tener al menos 6 caracteres"); return; }
    toast("Guardando…");
    let j;
    try{ j=await apiUsuarios('/api/editar-usuario', {id:u.id, nombre, apellido:ap, usuario:user, rol, activo, password:pass||undefined}); }
    catch(ex){ toast("⚠️ "+ex.message); return; }
    Object.assign(u,{nombre,ap,user:j.usuario||user,rol,activo});
    auditar("Usuario modificado","usuario",u.user,`${nombre} ${ap} · ${rol}${j.passwordCambiada?' · contraseña nueva':''}`);
    cerrarModal(); viewUsuarios();
    toast(j.passwordCambiada?"✅ Usuario actualizado · contraseña nueva":"✅ Usuario actualizado");
  } else {
    const pass = $("#uPass").value;
    if(!pass){ $("#uPass").classList.add("err"); toast("⚠️ Asigná una contraseña"); return; }
    if(pass.length<6){ $("#uPass").classList.add("err"); toast("⚠️ La contraseña tiene que tener al menos 6 caracteres"); return; }
    const userNorm = user.toLowerCase().replace(/\s+/g,'-');
    if(!/^[a-z0-9._-]+$/.test(userNorm)){ $("#uUser").classList.add("err"); toast("⚠️ El usuario solo puede tener letras, números, puntos o guiones (sin espacios ni acentos)"); return; }
    const email = userNorm+'@aura.local';
    const { data:{ session } } = await SB.auth.getSession();
    toast("Creando usuario…");
    let j;
    try{
      const r = await fetch('/api/crear-usuario', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?session.access_token:'')}, body: JSON.stringify({ email, password:pass, nombre, apellido:ap, usuario:userNorm, rol }) });
      j = await r.json();
      if(!r.ok){ toast("⚠️ "+(j.error||'No se pudo crear el usuario')); return; }
    }catch(ex){ toast("⚠️ Error de conexión al crear el usuario"); return; }
    USUARIOS.push({ id:j.id, nombre, ap, user:userNorm, rol, activo:true, pass:'••••' });
    auditar("Usuario creado","usuario",userNorm,`${nombre} ${ap} · ${rol}`);
    cerrarModal(); viewUsuarios(); toast("✅ Usuario creado");
  }
};


/* ---- Estado en línea (columna Estado): persistir en la base ---- */
const _cambiarEstadoInline = window.cambiarEstadoInline;
window.cambiarEstadoInline = function(nro, val){
  const previo = (VENTAS.find(x=>x.nro===nro)||{}).estado;
  _cambiarEstadoInline(nro, val);
  const v = VENTAS.find(x=>x.nro===nro);
  if(v && v.estado===val){
    guardarCampo('ventas',nro,{estado:val},"el estado de la venta #"+nro).then(ok=>{
      if(!ok && previo!=null){ v.estado=previo; renderTablaVentas(); }
    });
  }
};

/* ---- Confirmar cobros (lista de trabajo): resincroniza pagos + saldo y manda SOLO el remito si se pidió ---- */
const _confirmarCobros = window.confirmarCobros;
window.confirmarCobros = async function(nro){
  const mailEl=$("#cobMail"); const enviar=!!(mailEl && mailEl.checked);
  _confirmarCobros(nro);   // aplica en memoria + audita + cierra modal + toast
  const v=VENTAS.find(x=>x.nro===nro); if(!v) return;
  try{
    /* Insertamos los pagos nuevos ANTES de borrar los viejos: si el insert
       falla, los cobros originales siguen en la base (antes se perdían). */
    const {data:viejos}=await SB.from('pagos').select('id').eq('venta_id', nro);
    if(v.pagos && v.pagos.length){
      const r=await SB.from('pagos').insert(v.pagos.map(p=>({venta_id:nro, monto:p.monto, metodo:p.metodo, fecha:p.fecha, usuario:p.usuario})));
      if(r.error) throw r.error;
    }
    if(viejos && viejos.length){
      const rd=await SB.from('pagos').delete().in('id', viejos.map(x=>x.id));
      if(rd.error) throw rd.error;
    }
    const r2=await SB.from('ventas').update({saldo:v.saldo}).eq('id', nro);
    if(r2.error) throw r2.error;
    respaldarEnSheet(nro);
  }catch(ex){
    toast("⚠️ Guardado en pantalla, pero error guardando en la base: "+(ex.message||ex));
    return;   // sin guardar no mandamos un comprobante con datos que no coinciden
  }
  if(enviar){
    const c=CLIENTES.find(x=>x.id===v.clienteId)||{};
    if(!c.mail){ toast("⚠️ El cliente no tiene email cargado"); return; }
    toast("Enviando comprobante…");
    try{
      const j=await enviarRemito({nro, soloRemito:true, tipo:'cobro'});
      toast("✅ Comprobante enviado a "+(j.email||c.mail));
    }catch(ex){ toast("⚠️ "+(ex.message||'No se pudo enviar el comprobante')); }
  }
};

/* Acá había una restauración automática de sesión. Se quitó a propósito
   (2026-08-02): en una computadora compartida hacía que el siguiente en abrir
   el sistema entrara con el usuario del anterior — por ejemplo, un vendedor
   entrando como Maestro. El sistema siempre tiene que pedir usuario y
   contraseña. No volver a agregarla.

   Limpieza: las sesiones que esa versión dejó guardadas en las computadoras
   ya no las usa nadie, pero las borramos para no dejar el token dando vueltas. */
try{
  Object.keys(localStorage)
    .filter(k=>k.startsWith('sb-') && k.includes('auth-token'))
    .forEach(k=>localStorage.removeItem(k));
}catch(_){}
