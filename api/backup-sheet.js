/* Función de servidor (Vercel) — Copia cada venta en la planilla de Google.
   Se llama sola cuando se carga, edita, cobra o cancela una venta.

   Igual que el remito: el navegador manda SOLO el número de venta y acá se
   arman los datos leyéndolos de la base. Así nadie puede escribir en la
   planilla importes o clientes inventados desde la consola.

   Variables de entorno necesarias en Vercel:
     SHEET_WEBHOOK_URL  · la dirección .../exec que da Google Apps Script
     SHEET_TOKEN        · la contraseña que pusiste dentro del Apps Script  */
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // Si todavía no se configuró la planilla, no es un error: simplemente no hacemos nada.
  if (!process.env.SHEET_WEBHOOK_URL || !process.env.SHEET_TOKEN) {
    return res.status(200).json({ ok: false, sinConfigurar: true });
  }

  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Quien llama tiene que tener sesión válida
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u || !u.user) return res.status(401).json({ error: 'Sesión no válida' });

    const nro = Number((req.body || {}).nro);
    if (!nro) return res.status(400).json({ error: 'Falta el número de venta' });

    // Datos reales, leídos de la base
    const { data: venta, error: ev } = await admin.from('ventas').select('*').eq('id', nro).single();
    if (ev || !venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const [{ data: items }, { data: pagos }, { data: cliente }] = await Promise.all([
      admin.from('venta_items').select('*').eq('venta_id', nro).order('id'),
      admin.from('pagos').select('monto').eq('venta_id', nro),
      venta.cliente_id
        ? admin.from('clientes').select('*').eq('id', venta.cliente_id).single()
        : Promise.resolve({ data: null })
    ]);

    const lista = items || [];
    const cobrado = (pagos || []).reduce((a, p) => a + Number(p.monto || 0), 0);
    const c = cliente || {};

    const payload = {
      token: process.env.SHEET_TOKEN,
      venta: {
        nro: venta.id,
        fecha: venta.fecha || '',
        estado: venta.cancelada ? 'CANCELADA' : (venta.estado || ''),
        vendedor: venta.vendedor || '',
        clienteId: venta.cliente_id || '',
        cliente: venta.cliente_nombre || `${c.nombre || ''} ${c.apellido || ''}`.trim(),
        dni: c.dni || '',
        telefono: c.telefono || '',
        email: c.email || '',
        provincia: venta.provincia || c.provincia || '',
        localidad: venta.localidad || c.localidad || '',
        entrega: venta.entrega || '',
        productos: lista.map(i => i.nombre).join(' | '),
        cantidades: lista.map(i => i.cantidad).join(' | '),
        total: Number(venta.total || 0),
        iva: Number(venta.iva || 0),
        cobrado,
        saldo: Number(venta.saldo || 0),
        nota: venta.nota || ''
      }
    };

    const r = await fetch(process.env.SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const texto = await r.text();

    /* OJO: cuando la aplicación web de Apps Script no está publicada para
       "Cualquier usuario", Google NO da error: responde 200 con el HTML de la
       pantalla de login. Si solo miráramos el código de estado, daríamos por
       bueno un envío que nunca se escribió. Por eso exigimos que la respuesta
       sea el JSON que devuelve nuestro script. */
    let j = null;
    try { j = JSON.parse(texto); } catch (_) { /* no es JSON: ver abajo */ }

    if (!j || typeof j.ok === 'undefined') {
      const pideLogin = /accounts\.google\.com|ServiceLogin|iniciar sesión|sign in/i.test(texto);
      return res.status(502).json({
        error: pideLogin
          ? 'La planilla pidió iniciar sesión. En Apps Script → Implementar → editar la implementación, poné "Quién tiene acceso: Cualquier usuario".'
          : 'La dirección no respondió como se esperaba. Revisá que sea la que termina en /exec y que la implementación sea de tipo "Aplicación web".',
        respuesta: texto.slice(0, 300)
      });
    }
    if (j.ok === false) {
      return res.status(502).json({
        error: j.error === 'Token inválido'
          ? 'La contraseña no coincide: el TOKEN del Apps Script tiene que ser igual a SHEET_TOKEN en Vercel.'
          : (j.error || 'La planilla rechazó el dato')
      });
    }
    return res.status(200).json({ ok: true, fila: j.fila || null });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
