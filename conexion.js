/* ============================================================
   AURA MINIPISCINAS — Conexión a Supabase (login + datos reales)
   Este archivo se carga DESPUÉS del sistema y reemplaza el login
   y el guardado para que todo quede en la base de datos.
   ============================================================ */

const SB = window.supabase.createClient(
  "https://dnamctecmutlmgblhnbg.supabase.co",
  "sb_publishable_GMWcvSFIPklV9e9PCb0c2g_GMKR_J-w"
);

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

  PRODUCTOS.length=0; (p.data||[]).forEach(r=>PRODUCTOS.push({id:r.id,nombre:r.nombre,desc:r.descripcion||'',cat:r.categoria,precio:Number(r.precio),stock:r.stock,activo:r.activo!==false}));
  CLIENTES.length=0; (c.data||[]).forEach(r=>CLIENTES.push({id:r.id,nombre:r.nombre,apellido:r.apellido,dni:r.dni,tel:r.telefono,mail:r.email,provincia:r.provincia,localidad:r.localidad,saldo:Number(r.saldo||0),activo:r.activo!==false}));
  ESTADOS.length=0; (e.data||[]).forEach(r=>ESTADOS.push({nombre:r.nombre,color:r.color||'gris'}));
  CATEGORIAS.length=0; (cat.data||[]).forEach(r=>CATEGORIAS.push(r.nombre));
  const byV={}; (vi.data||[]).forEach(r=>{(byV[r.venta_id]=byV[r.venta_id]||[]).push({nombre:r.nombre,precio:Number(r.precio),cant:r.cantidad,categoria:r.categoria});});
  VENTAS.length=0; (v.data||[]).forEach(r=>VENTAS.push({nro:r.id,cliente:r.cliente_nombre||'',localidad:r.localidad||'',provincia:r.provincia||'',total:Number(r.total),saldo:Number(r.saldo||0),estado:r.estado,vendedor:r.vendedor||'',fecha:r.fecha,entrega:r.entrega||'',clienteId:r.cliente_id,cancelada:r.cancelada===true,nota:r.nota||'',items:byV[r.id]||[]}));
  HISTORIAL.length=0; historialDesdeVentas(VENTAS).forEach(l=>HISTORIAL.push(l));
  USUARIOS.length=0; (per.data||[]).forEach(r=>USUARIOS.push({id:r.id,nombre:r.nombre||'',ap:r.apellido||'',user:r.usuario||'',rol:r.rol,activo:r.activo!==false,pass:'••••'}));
}

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
  USUARIO_ACTUAL={nombre:perfil.nombre||'Usuario',ap:perfil.apellido||'',rol:perfil.rol};
  try{ await cargarTodo(); }catch(ex){ $("#logErr").textContent="Error cargando datos: "+ex.message; return; }
  $("#logErr").textContent="";
  $("#loginScreen").style.display="none"; $("#appWrap").style.display="";
  actualizarTopbarUsuario();
  vistaActual=tabsPermitidas()[0];
  nav(vistaActual);
};

window.salir = async function(){
  try{ await SB.auth.signOut(); }catch(e){}
  $("#appWrap").style.display="none"; $("#loginScreen").style.display="flex";
  $("#logPass").value=""; $("#logErr").textContent="";
  const u=$("#logUser"); if(u) u.focus();
};

/* ---- Guardado: NUEVA VENTA (+ ítems) ---- */
window.confirmarVenta = async function(){
  if(!clienteActual){ toast("⚠️ Cargá el cliente primero"); return; }
  if(!carrito.length){ toast("⚠️ Agregá al menos un producto"); return; }
  const c=clienteActual;
  const total=carrito.reduce((a,i)=>a+i.precio*i.cant,0);
  const cobrado=Math.min(total,+($("#vCobro").value||0));
  const entrega=($("#vEntrega")?.value||"")||null;
  const nota=($("#vNota")?.value||"").trim();
  const remito=$("#vRemito").checked;
  const {data,error}=await SB.from('ventas').insert({
    cliente_id:c.id, cliente_nombre:`${c.nombre} ${c.apellido}`, vendedor:nombreUsuario(),
    fecha:new Date().toISOString().slice(0,10), entrega, total, saldo:total-cobrado,
    estado:"Procesando pedido", provincia:c.provincia, localidad:`${c.localidad} (${c.provincia})`, nota
  }).select().single();
  if(error){ toast("⚠️ Error al guardar la venta: "+error.message); return; }
  const nro=data.id;
  const items=carrito.map(i=>({venta_id:nro,nombre:i.nombre,precio:i.precio,cantidad:i.cant,categoria:(PRODUCTOS.find(p=>p.id===i.id)||{}).cat||null}));
  if(items.length){ const r=await SB.from('venta_items').insert(items); if(r.error){ toast("⚠️ Venta guardada, pero error en ítems: "+r.error.message); } }
  // Envío automático del remito por mail (no bloquea la pantalla)
  if(remito && c.mail){
    SB.auth.getSession().then(({data:{session}})=>{
      fetch('/api/enviar-remito',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?session.access_token:'')},
        body:JSON.stringify({venta:{nro,cliente:`${c.nombre} ${c.apellido}`,vendedor:nombreUsuario(),total,email:c.mail,items:carrito.map(i=>({nombre:i.nombre,precio:i.precio,cant:i.cant}))}})
      }).then(r=>r.json()).then(j=>{ if(!j.ok) console.warn('Remito mail:',j.error); }).catch(e=>console.warn('Remito mail:',e));
    });
  }
  VENTAS.unshift({nro,cliente:`${c.nombre} ${c.apellido}`,localidad:`${c.localidad} (${c.provincia})`,provincia:c.provincia,total,saldo:total-cobrado,estado:"Procesando pedido",vendedor:nombreUsuario(),fecha:data.fecha,entrega:entrega||"",clienteId:c.id,cancelada:false,nota,items:carrito.map(i=>({nombre:i.nombre,precio:i.precio,cant:i.cant,categoria:(PRODUCTOS.find(p=>p.id===i.id)||{}).cat}))});
  toast(`✅ Venta #${nro} guardada`+(remito?` · remito a ${c.mail}`:""));
  nav("ventas");
};

/* ---- Guardado: CLIENTE (alta/edición) ---- */
window.guardarCliente = async function(){
  const campos={nombre:$("#cNombre"),apellido:$("#cApellido"),dni:$("#cDni"),tel:$("#cTel"),provincia:$("#cProvincia"),localidad:$("#cLocalidad"),mail:$("#cMail")};
  let faltan=false; Object.values(campos).forEach(el=>{const v=!el.value.trim(); el.classList.toggle("err",v); if(v)faltan=true;});
  if(faltan){ toast("⚠️ Completá todos los campos obligatorios (*)"); return; }
  const mail=campos.mail.value.trim();
  if(!/^\S+@\S+\.\S+$/.test(mail)){ campos.mail.classList.add("err"); toast("⚠️ Revisá el email del cliente"); return; }
  const datos={nombre:campos.nombre.value.trim(),apellido:campos.apellido.value.trim(),dni:campos.dni.value.trim(),tel:campos.tel.value.trim(),provincia:campos.provincia.value,localidad:campos.localidad.value.trim(),mail};
  const fila={nombre:datos.nombre,apellido:datos.apellido,dni:datos.dni,telefono:datos.tel,email:datos.mail,provincia:datos.provincia,localidad:datos.localidad};
  const editId = (modalModo==="venta" && clienteActual) ? clienteActual.id
               : (typeof clienteEditId!=="undefined" && clienteEditId!=null) ? clienteEditId : null;
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
};

/* ---- Guardado: PRODUCTO (alta/edición) ---- */
window.guardarProducto = async function(id){
  const nombre=$("#pNombre").value.trim(), cat=$("#pCat").value, precioRaw=$("#pPrecio").value, desc=$("#pDesc").value.trim(), stockRaw=$("#pStock").value.trim();
  let falta=false; [["pNombre",!nombre],["pCat",!cat],["pPrecio",precioRaw===""||isNaN(+precioRaw)]].forEach(([i,b])=>{$("#"+i).classList.toggle("err",b); if(b)falta=true;});
  if(falta){ toast("⚠️ Completá nombre, categoría y un precio válido"); return; }
  const precio=+precioRaw;
  const stock=stockRaw===""?"No Desc":stockRaw;
  const fila={nombre,descripcion:desc,categoria:cat,precio,stock:String(stock)};
  if(id!=null){ const r=await SB.from('productos').update(fila).eq('id',id); if(r.error){ toast("⚠️ Error: "+r.error.message); return; } Object.assign(PRODUCTOS.find(x=>x.id===id),{nombre,desc,cat,precio,stock}); }
  else { const {data,error}=await SB.from('productos').insert({...fila,activo:true}).select().single(); if(error){ toast("⚠️ Error: "+error.message); return; } PRODUCTOS.push({id:data.id,nombre,desc,cat,precio,stock,activo:true}); }
  cerrarModal(); viewProductos(); toast("✅ Producto guardado");
};

/* ---- Activar/Inactivar y cambios de estado (envuelven la función original) ---- */
const _toggleProducto=window.toggleProducto;
window.toggleProducto=function(id){ _toggleProducto(id); const p=PRODUCTOS.find(x=>x.id===id); if(p) SB.from('productos').update({activo:p.activo}).eq('id',id).then(()=>{}); };

const _toggleCliente=window.toggleCliente;
window.toggleCliente=function(id){ _toggleCliente(id); const c=CLIENTES.find(x=>x.id===id); if(c) SB.from('clientes').update({activo:c.activo}).eq('id',id).then(()=>{}); };

const _guardarEstadoVenta=window.guardarEstadoVenta;
window.guardarEstadoVenta=function(nro){ _guardarEstadoVenta(nro); const v=VENTAS.find(x=>x.nro===nro); if(v) SB.from('ventas').update({estado:v.estado}).eq('id',nro).then(()=>{}); };

const _confirmarCancelarVenta=window.confirmarCancelarVenta;
window.confirmarCancelarVenta=function(nro){ _confirmarCancelarVenta(nro); SB.from('ventas').update({cancelada:true}).eq('id',nro).then(()=>{}); };

/* ---- Catálogos (reemplazan la lista completa en la base) ---- */
const _guardarEstados=window.guardarEstados;
window.guardarEstados=async function(){ _guardarEstados(); try{ await SB.from('estados').delete().neq('id',-1); await SB.from('estados').insert(ESTADOS.map((e,i)=>({nombre:e.nombre,color:e.color,orden:i+1}))); }catch(ex){ toast("⚠️ Error guardando estados: "+ex.message); } };

const _guardarCategorias=window.guardarCategorias;
window.guardarCategorias=async function(){ _guardarCategorias(); try{ await SB.from('categorias').delete().neq('id',-1); await SB.from('categorias').insert(CATEGORIAS.map((c,i)=>({nombre:c,orden:i+1}))); }catch(ex){ toast("⚠️ Error guardando categorías: "+ex.message); } };

/* ---- Usuarios: editar perfil/rol/estado (el alta de login se hace en Supabase) ---- */
const _toggleUsuario=window.toggleUsuario;
window.toggleUsuario=function(i){ _toggleUsuario(i); const u=USUARIOS[i]; if(u&&u.id) SB.from('perfiles').update({activo:u.activo}).eq('id',u.id).then(()=>{}); };

window.guardarUsuario=async function(i){
  const nombre=$("#uNombre").value.trim(), ap=$("#uAp").value.trim(), user=$("#uUser").value.trim(), rol=$("#uRol").value, activo=$("#uActivo").value==="1";
  if(!nombre||!ap||!user){ toast("⚠️ Completá nombre, apellido y usuario"); return; }
  if(i!=null){
    const u=USUARIOS[i]; const r=await SB.from('perfiles').update({nombre,apellido:ap,usuario:user,rol,activo}).eq('id',u.id);
    if(r.error){ toast("⚠️ Error: "+r.error.message); return; }
    Object.assign(u,{nombre,ap,user,rol,activo}); cerrarModal(); viewUsuarios(); toast("✅ Usuario actualizado");
  } else {
    const pass = $("#uPass").value;
    if(!pass){ $("#uPass").classList.add("err"); toast("⚠️ Asigná una contraseña"); return; }
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
    cerrarModal(); viewUsuarios(); toast("✅ Usuario creado");
  }
};
