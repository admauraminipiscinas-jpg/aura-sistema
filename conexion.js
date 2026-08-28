/* ============================================================
   AURA MINIPISCINAS — Conexión a Supabase (login + datos reales)
   Este archivo se carga DESPUÉS del sistema y reemplaza el login
   y el guardado para que todo quede en la base de datos.
   ============================================================ */

/* ====== SESIÓN ==============================================================
   La sesión queda guardada SOLO si la persona tildó "Mantener sesión iniciada"
   en la pantalla de entrada. Si la tildó, el token se guarda en esa computadora
   y sobrevive a cerrar el navegador; si no, queda solo en memoria y al recargar
   hay que volver a poner la contraseña.

   En los dos casos la sesión se cierra sola después de 2 horas sin usar el
   sistema. ESTO NO HAY QUE SACARLO: las computadoras del local las usa más de
   una persona, y sin el corte por inactividad el siguiente que abre el sistema
   entra con el usuario del anterior (un vendedor entrando como Maestro). El
   tilde opcional + el corte por inactividad son lo que permite la comodidad de
   no reingresar la contraseña sin volver a ese problema. */
const RECORDAR_KEY   = 'aura.recordar';
const ACTIVIDAD_KEY  = 'aura.ultimaActividad';
const INACTIVIDAD_MS = 2 * 60 * 60 * 1000;   // 2 horas

function recordarActivo(){ try{ return localStorage.getItem(RECORDAR_KEY)==='1'; }catch(_){ return false; } }

/* Dónde se guarda el token: en la computadora o solo en memoria. */
const _memoria = {};
const almacenSesion = {
  getItem(k){ return recordarActivo() ? localStorage.getItem(k) : (k in _memoria ? _memoria[k] : null); },
  setItem(k,v){ if(recordarActivo()){ try{ localStorage.setItem(k,v); }catch(_){} } else _memoria[k]=v; },
  removeItem(k){ try{ localStorage.removeItem(k); }catch(_){} delete _memoria[k]; }
};

/* Reloj de inactividad. */
function marcarActividad(){ try{ localStorage.setItem(ACTIVIDAD_KEY, String(Date.now())); }catch(_){} }
function sesionVencida(){
  try{ const t = +(localStorage.getItem(ACTIVIDAD_KEY)||0); return t>0 && (Date.now()-t) > INACTIVIDAD_MS; }
  catch(_){ return false; }
}

const SB = window.supabase.createClient(
  "https://dnamctecmutlmgblhnbg.supabase.co",
  "sb_publishable_GMWcvSFIPklV9e9PCb0c2g_GMKR_J-w",
  { auth: { persistSession: true, autoRefreshToken: true, storage: almacenSesion } }
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
  CLIENTES.length=0; (c.data||[]).forEach(r=>CLIENTES.push({id:r.id,nombre:r.nombre,apellido:r.apellido,dni:r.dni,tel:r.telefono,mail:r.email,provincia:r.provincia,localidad:r.localidad,domicilio:r.domicilio||'',saldo:Number(r.saldo||0),activo:r.activo!==false}));
  ESTADOS.length=0; (e.data||[]).forEach(r=>ESTADOS.push({nombre:r.nombre,color:r.color||'gris'}));
  CATEGORIAS.length=0; (cat.data||[]).forEach(r=>CATEGORIAS.push(r.nombre));
  const pagosByV={}; pagosData.forEach(r=>{(pagosByV[r.venta_id]=pagosByV[r.venta_id]||[]).push({id:r.id,monto:Number(r.monto||0),metodo:r.metodo||'',fecha:r.fecha,usuario:r.usuario||'',chofer:r.chofer||null,rendido:r.rendido===true,rendido_fecha:r.rendido_fecha||null,rendido_por:r.rendido_por||''});});
  const byV={}; (vi.data||[]).forEach(r=>{(byV[r.venta_id]=byV[r.venta_id]||[]).push({nombre:r.nombre,precio:Number(r.precio),cant:r.cantidad,categoria:r.categoria});});
  VENTAS.length=0; (v.data||[]).forEach(r=>VENTAS.push({nro:r.id,cliente:r.cliente_nombre||'',localidad:r.localidad||'',provincia:r.provincia||'',total:Number(r.total),iva:Number(r.iva||0),factura:r.factura===true,saldo:Number(r.saldo||0),estado:r.estado,vendedor:r.vendedor||'',fecha:r.fecha,entrega:r.entrega||'',clienteId:r.cliente_id,cancelada:r.cancelada===true,nota:r.nota||'',chofer:r.chofer||null,items:byV[r.id]||[],pagos:pagosByV[r.id]||[]}));
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
  /* La preferencia se guarda ANTES de entrar: el token se escribe durante el
     login y tiene que saber si va a la computadora o solo a la memoria. */
  try{ localStorage.setItem(RECORDAR_KEY, ($("#logRecordar")&&$("#logRecordar").checked) ? '1' : '0'); }catch(_){}
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
  marcarActividad();
  $("#logErr").textContent="";
  $("#loginScreen").style.display="none"; $("#appWrap").style.display="";
  actualizarTopbarUsuario();
  nav(tabsPermitidas()[0]);
}

/* Volver a la pantalla de entrada. `motivo` se muestra en el cartel del login. */
function volverAlLogin(motivo){
  $("#appWrap").style.display="none"; $("#loginScreen").style.display="flex";
  $("#logPass").value="";
  const e=$("#logErr"); if(e){ e.style.color=""; e.textContent=motivo||""; }
  const u=$("#logUser"); if(u) u.focus();
}

window.salir = async function(){
  try{ await SB.auth.signOut(); }catch(e){}
  /* Borramos la marca de actividad pero dejamos la preferencia del tilde, así
     no hay que volver a tildarlo en la computadora propia cada vez. */
  try{ localStorage.removeItem(ACTIVIDAD_KEY); }catch(_){}
  volverAlLogin("");
};

/* Cierre automático cuando pasaron 2 horas sin tocar el sistema. */
async function cerrarPorInactividad(){
  try{ await SB.auth.signOut(); }catch(_){}
  try{ localStorage.removeItem(ACTIVIDAD_KEY); }catch(_){}
  volverAlLogin("Cerramos la sesión por seguridad: pasaron 2 horas sin usar el sistema.");
}

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
  /* Avisamos en pantalla si el correo salió o no. Antes el cartel decía
     "remito a tal mail" apenas se guardaba la venta, sin esperar la respuesta:
     si el envío fallaba (por ejemplo, porque venció la contraseña de Gmail)
     nadie se enteraba y el cliente se quedaba sin su comprobante. */
  if(remito && c.mail){
    enviarRemito({nro})
      .then(()=>toast(`📧 Remito enviado a ${c.mail}`))
      .catch(e=>{
        console.warn('Remito mail:',e);
        toast(`⚠️ La venta #${nro} se guardó, pero NO se pudo enviar el remito a ${c.mail}. Reenvialo con el botón 📤.`);
      });
  }
  VENTAS.unshift({nro,cliente:`${c.nombre} ${c.apellido}`,localidad:`${c.localidad} (${c.provincia})`,provincia:c.provincia,total,iva,factura:ventaFactura,saldo:gran-cobrado,estado:"Procesando pedido",vendedor:carga.vendedor,fecha:data.fecha,entrega:entrega||"",clienteId:c.id,cancelada:false,nota,pagos,items:carrito.map(i=>({nombre:i.nombre,precio:i.precio,cant:i.cant,categoria:(PRODUCTOS.find(p=>p.id===i.id)||{}).cat}))});
  /* La auditoría registra quién la cargó (nombreUsuario) y, si es histórica,
     a quién se le atribuyó y con qué fecha. */
  auditar(carga.historica?"Venta cargada (histórica)":"Venta creada","venta",nro,
    `Cliente ${c.nombre} ${c.apellido} · Total ${money(gran)}${ventaFactura?' (c/IVA)':''}`+
    (carga.historica?` · fecha ${fmtFechaCorta(carga.fecha)} · vendedor ${carga.vendedor}`:''));
  toast(`✅ Venta #${nro} guardada`+(carga.historica?` · ${fmtFechaCorta(carga.fecha)} · ${carga.vendedor}`:'')+(remito&&c.mail?` · enviando remito…`:""));
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
    if(j.sinConfigurar){
      /* Faltan las variables en Vercel. Avisamos una vez por sesión: si alguien
         ya creó la planilla y configuró todo, tiene que enterarse de que no está
         llegando; si nunca la usó, el cartel aparece una sola vez y listo. */
      if(!window.__avisoSheet){
        window.__avisoSheet = true;
        toast("⚠️ La planilla de respaldo no está conectada: faltan SHEET_WEBHOOK_URL y SHEET_TOKEN en Vercel.");
      }
      return;
    }
    if(!j.ok){
      console.warn('Copia en la planilla:', j.error||'no se pudo guardar', j.respuesta||'');
      /* Avisamos en pantalla una sola vez por sesión: si la copia de seguridad
         no está funcionando hay que enterarse, pero sin repetir el cartel en
         cada venta. */
      if(!window.__avisoSheet){
        window.__avisoSheet = true;
        toast("⚠️ La venta se guardó, pero NO se copió a la planilla de Google. Probá la conexión desde Ventas → ⚙️.");
      }
    }
  }catch(ex){ console.warn('Copia en la planilla:', ex.message||ex); }
}

/* Prueba de la conexión con la planilla: manda la última venta y muestra en
   pantalla el resultado exacto, para no tener que mirar los registros de Vercel. */
window.probarSheet = async function(){
  const v = VENTAS[0];
  if(!v){ toast("No hay ventas para probar"); return; }
  toast("Probando la conexión con la planilla…");
  try{
    const {data:{session}} = await SB.auth.getSession();
    const r = await fetch('/api/backup-sheet',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?session.access_token:'')},
      body: JSON.stringify({nro:v.nro})
    });
    let j={}; try{ j = await r.json(); }catch(_){ }
    if(j.sinConfigurar){ toast("⚠️ Faltan cargar SHEET_WEBHOOK_URL y SHEET_TOKEN en Vercel (y hacer Redeploy)."); return; }
    if(j.ok){ window.__avisoSheet=false; toast(`✅ Funciona: la venta #${v.nro} quedó escrita en la planilla`); return; }
    toast("⚠️ "+(j.error||"No se pudo escribir en la planilla"));
    console.warn('Prueba de planilla:', j);
  }catch(ex){ toast("⚠️ Error de conexión: "+(ex.message||ex)); }
};

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
  const datos={nombre:campos.nombre.value.trim(),apellido:campos.apellido.value.trim(),dni:campos.dni.value.trim(),tel:campos.tel.value.trim(),provincia:campos.provincia.value,localidad:campos.localidad.value.trim(),mail,
    domicilio:(($("#cDomicilio")||{}).value||"").trim()};   // opcional: queda vacío si no lo cargan
  const fila={nombre:datos.nombre,apellido:datos.apellido,dni:datos.dni,telefono:datos.tel,email:datos.mail,provincia:datos.provincia,localidad:datos.localidad,domicilio:datos.domicilio};
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
      /* Mostramos el cartel con el botón "Usar este cliente" para que no quede
         trabado: el DNI no se puede repetir, pero la ficha que ya existe se
         puede reutilizar para esta venta. */
      if(typeof chequearDniExistente==="function") chequearDniExistente();
      toast(`⚠️ El DNI ${datos.dni} ya es de ${repetido.nombre} ${repetido.apellido||''}. Usá el botón "Usar este cliente".`.replace(/\s+/g,' '));
      return;
    }
  }
  if(editId!=null){
    const r=await SB.from('clientes').update(fila).eq('id',editId); if(r.error){ toast("⚠️ Error: "+r.error.message); return; }
    if(modalModo==="venta" && clienteActual) Object.assign(clienteActual,datos);
    const reg=CLIENTES.find(x=>x.id===editId); if(reg) Object.assign(reg,{nombre:datos.nombre,apellido:datos.apellido,dni:datos.dni,tel:datos.tel,mail:datos.mail,provincia:datos.provincia,localidad:datos.localidad,domicilio:datos.domicilio});
  } else {
    const {data,error}=await SB.from('clientes').insert(fila).select().single(); if(error){ toast("⚠️ Error al guardar el cliente: "+error.message); return; }
    const id=data.id;
    CLIENTES.push({id,nombre:datos.nombre,apellido:datos.apellido,dni:datos.dni,tel:datos.tel,mail:datos.mail,provincia:datos.provincia,localidad:datos.localidad,domicilio:datos.domicilio,saldo:0,activo:true});
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
window.guardarEstadoVenta=function(nro){ _guardarEstadoVenta(nro); const v=VENTAS.find(x=>x.nro===nro); if(v) guardarCampo('ventas',nro,{estado:v.estado},"el estado de la venta #"+nro).then(ok=>{ if(ok){ sincronizarChofer(nro); respaldarEnSheet(nro); } }); };

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
      else { sincronizarChofer(nro).then(okCh=>{ if(!okCh && previo!=null){ v.estado=previo; guardarCampo('ventas',nro,{estado:previo},"el estado de la venta #"+nro); renderTablaVentas(); } }); respaldarEnSheet(nro); }
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

/* HISTORIAL DE ESTA DECISIÓN — leer antes de tocar la sesión.
   · 2026-08-02: se había puesto restauración automática de sesión y se quitó,
     porque en una computadora compartida el siguiente en abrir el sistema
     entraba con el usuario del anterior (un vendedor entrando como Maestro).
   · 2026-08-07: la dueña pidió volver a tenerla, pero resuelta de otra forma
     para no repetir ese problema. Ahora la sesión se guarda SOLO si la persona
     tilda "Mantener sesión iniciada" (en la computadora compartida se deja sin
     tildar), y ADEMÁS se cierra sola a las 2 horas sin uso.
   La implementación está al principio y al final de este archivo. Lo que no hay
   que hacer es dejar la sesión guardada para todos y sin corte por inactividad:
   eso es exactamente lo que hubo que revertir en agosto. */

/* ====== ARRANQUE: retomar la sesión y vigilar la inactividad ==============
   Si quedó una sesión guardada (tilde "Mantener sesión iniciada") y no pasaron
   más de 2 horas sin uso, entramos derecho sin pedir la contraseña. */
window.addEventListener('load', async function(){
  /* Dejamos el tilde como lo eligió la última vez en esta computadora. */
  const chk = $("#logRecordar"); if(chk) chk.checked = recordarActivo();

  try{
    if(sesionVencida()){
      try{ await SB.auth.signOut(); }catch(_){}
      try{ localStorage.removeItem(ACTIVIDAD_KEY); }catch(_){}
      return;
    }
    const {data:{session}} = await SB.auth.getSession();
    if(!session || !session.user) return;                 // no hay sesión: login normal
    const {data:perfil} = await SB.from('perfiles').select('*').eq('id',session.user.id).single();
    if(!perfil || perfil.activo===false){ try{ await SB.auth.signOut(); }catch(_){} return; }
    await abrirApp(perfil);
  }catch(_){ /* si algo falla, simplemente queda la pantalla de entrada */ }
});

/* Cada acción de la persona corre el reloj. Anotamos como mucho una vez cada
   30 segundos para no estar escribiendo todo el tiempo. */
let _ultimaMarca = 0;
['click','keydown','touchstart','scroll'].forEach(function(ev){
  document.addEventListener(ev, function(){
    const ahora = Date.now();
    if(ahora - _ultimaMarca < 30000) return;
    _ultimaMarca = ahora; marcarActividad();
  }, {passive:true});
});

/* Control cada minuto: si venció, cierra sola. */
setInterval(function(){
  const app = $("#appWrap");
  if(!app || app.style.display === "none") return;   // no hay nadie adentro
  if(sesionVencida()) cerrarPorInactividad();
}, 60000);

/* ====== CHOFERES: asignación, cobros y rendición ==========================
   El chofer se guarda en un campo propio (ventas.chofer), NO en el estado.
   Se completa solo a partir del estado, con estas reglas:
     "En camino Omar"       -> chofer = Omar
     "Procesando pedido"    -> chofer = vacío (todavía no salió)
     "Entregado al cliente" -> se MANTIENE el que tenía
   La última es la importante: al entregar, el chofer recién ahí tiene la plata
   en la mano, así que la venta tiene que seguir en su cuenta corriente. */
function choferSegunEstado(estado, choferActual){
  const e = String(estado||"").toLowerCase().trim();
  const m = e.match(/^en camino\s+(.+)$/);
  if(m) return m[1].trim().replace(/^./,c=>c.toUpperCase());
  if(e.includes("procesando") || e.includes("presupuesto")) return null;
  return choferActual || null;   // entregado / post venta: no se toca
}

/* Guarda el chofer que corresponde al estado nuevo. Devuelve false si había
   plata cobrada sin rendir y por eso NO conviene sacarle la venta al chofer. */
async function sincronizarChofer(nro){
  const v = VENTAS.find(x=>x.nro===nro); if(!v) return true;
  const nuevo = choferSegunEstado(v.estado, v.chofer);
  if(nuevo === (v.chofer||null)) return true;
  /* Resguardo: si el chofer ya cobró plata de esta venta y no la rindió, no
     lo dejamos desaparecer en silencio; eso es plata real que alguien tiene. */
  const cobradoSinRendir = (v.pagos||[]).some(p=>p.chofer && p.chofer===v.chofer && !p.rendido);
  if(cobradoSinRendir && nuevo !== v.chofer){
    toast(`⚠️ ${v.chofer} ya cobró plata de la venta #${nro} y no la rindió. Rendila primero.`);
    return false;
  }
  const r = await SB.from('ventas').update({chofer:nuevo}).eq('id',nro).select('id');
  if(r.error || !r.data || !r.data.length){ toast("⚠️ No se pudo asignar el chofer de la venta #"+nro); return false; }
  v.chofer = nuevo;
  return true;
}

/* Registrar lo que el chofer cobró de cada cliente. Cada cobro entra como un
   pago normal de la venta (así el saldo del cliente baja solo) pero marcado
   con el chofer y sin rendir: eso es lo que arma su cuenta corriente. */
window.guardarCobrosChofer = function(){
  return unSoloGuardado('cobrosChofer', '#btnGuardarCobrosChofer', async function(){
    const ch = chofSel;
    const aCargar = cobrosChofer.filter(c=>Number(c.cobro||0) > 0);
    if(!aCargar.length){ toast("⚠️ No cargaste ningún cobro"); return; }
    const hoy = hoyISO();
    try{
      for(const c of aCargar){
        const v = VENTAS.find(x=>x.nro===c.nro); if(!v) continue;
        const monto = Math.min(Number(c.cobro||0), Number(v.saldo||0));
        if(monto <= 0) continue;
        const ins = await SB.from('pagos').insert({
          venta_id:c.nro, monto, metodo:'Efectivo (chofer)', fecha:hoy,
          usuario:nombreUsuario(), chofer:ch, rendido:false
        }).select('id').single();
        if(ins.error) throw ins.error;
        const nuevoSaldo = Math.max(0, Number(v.saldo||0) - monto);
        const up = await SB.from('ventas').update({saldo:nuevoSaldo}).eq('id',c.nro).select('id');
        if(up.error) throw up.error;
        if(!up.data || !up.data.length) throw new Error("no tenés permiso para actualizar la venta #"+c.nro);
        v.saldo = nuevoSaldo;
        v.pagos = v.pagos || [];
        v.pagos.push({id:ins.data.id, monto, metodo:'Efectivo (chofer)', fecha:hoy,
                      usuario:nombreUsuario(), chofer:ch, rendido:false, rendido_fecha:null, rendido_por:''});
        respaldarEnSheet(c.nro);
      }
      const tot = aCargar.reduce((a,c)=>a+Number(c.cobro||0),0);
      auditar("Cobros de chofer","chofer",ch,`${aCargar.length} venta(s) · ${money(tot)}`);
      cerrarModal(); viewChoferes();
      toast(`✅ Cobros de ${ch} registrados · ${money(tot)}`);
    }catch(ex){
      toast("⚠️ No se pudieron guardar los cobros: "+(ex.message||ex));
      try{ await cargarTodo(); viewChoferes(); }catch(_){}
    }
  });
};

/* Rendición: el chofer entregó la plata. Marca todos sus pagos pendientes
   como rendidos; a partir de ahí salen de la cuenta corriente y pasan al
   historial. Los cierres no se editan. */
window.confirmarRendicion = function(){
  return unSoloGuardado('rendicion', '#btnRendir', async function(){
    const ch = chofSel;
    const pend = pendientesDe(ch);
    if(!pend.length){ toast("No hay nada para rendir"); return; }
    const quien = ($("#rendPor") && $("#rendPor").value.trim()) || nombreUsuario();
    const ahora = new Date().toISOString();
    const ids = pend.map(x=>x.pago.id).filter(Boolean);
    if(ids.length !== pend.length){
      toast("⚠️ Hay cobros sin identificar. Volvé a entrar al sistema y probá de nuevo."); return;
    }
    try{
      const r = await SB.from('pagos')
        .update({rendido:true, rendido_fecha:ahora, rendido_por:quien})
        .in('id', ids).select('id');
      if(r.error) throw r.error;
      if(!r.data || r.data.length !== ids.length) throw new Error("no tenés permiso para cerrar la rendición");
      const tot = pend.reduce((a,x)=>a+Number(x.pago.monto||0),0);
      pend.forEach(({pago})=>{ pago.rendido=true; pago.rendido_fecha=ahora; pago.rendido_por=quien; });
      auditar("Rendición de chofer","chofer",ch,`${money(tot)} · ${pend.length} cobro(s) · recibió ${quien}`);
      cerrarModal(); viewChoferes();
      toast(`✅ ${ch} rindió ${money(tot)} · cuenta en cero`);
    }catch(ex){
      toast("⚠️ No se pudo cerrar la rendición: "+(ex.message||ex));
      try{ await cargarTodo(); viewChoferes(); }catch(_){}
    }
  });
};
