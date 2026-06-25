/* Función de servidor (Vercel) — Envía al cliente el correo de su compra.
   Adjunta DOS PDF: el remito (que se genera acá) y el manual de usuario
   (uno para todos, tomado del propio sitio). El correo tiene diseño
   aspiracional: header de marca, hero con el estado, detalle de la orden,
   timeline de seguimiento y los canales de contacto.
   Claves: GMAIL_USER, GMAIL_APP_PASSWORD (viven solo en el servidor). */
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

// El manual se sube al repo (raíz) y se sirve en esta URL. Si cambia el dominio, actualizar acá.
const MANUAL_URL = 'https://aura-sistema-sigma.vercel.app/manual-usuario-aura.pdf';

const montoAR = n => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function generarPDF(v) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  doc.setDrawColor(70);
  const kv = (x, y, label, value) => {
    doc.setFont('helvetica', 'bold'); doc.text(label, x, y);
    const w = doc.getTextWidth(label);
    doc.setFont('helvetica', 'normal'); doc.text(' ' + String(value == null || value === '' ? '—' : value), x + w, y);
  };

  // Banda ORIGINAL
  doc.setLineWidth(1); doc.rect(M, M, W - 2 * M, 20);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0);
  doc.text('ORIGINAL', W / 2, M + 14, { align: 'center' });

  // Encabezado
  let top = M + 20; doc.rect(M, top, W - 2 * M, 66);
  doc.setTextColor(63, 111, 94); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('AURA', M + 14, top + 30);
  doc.setFontSize(7); doc.setTextColor(107, 114, 128); doc.text('M I N I P I S C I N A S', M + 14, top + 42);
  doc.setTextColor(0); doc.setLineWidth(0.8); doc.rect(W / 2 - 26, top + 12, 52, 34);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('R', W / 2, top + 32, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text('Cod. 000', W / 2, top + 42, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Venta N°' + v.nro, W - M - 12, top + 22, { align: 'right' });
  doc.setFontSize(9); doc.text('Vendedor: ' + (v.vendedor || ''), W - M - 12, top + 38, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.text('Fecha de emisión: ' + (v.fecha || ''), W - M - 12, top + 52, { align: 'right' });

  // Datos del cliente
  let cy = top + 66; doc.setLineWidth(1); doc.rect(M, cy, W - 2 * M, 54);
  doc.setFontSize(9); doc.setTextColor(0);
  kv(M + 10, cy + 16, 'DNI:', v.dni);
  kv(M + 10, cy + 32, 'Localidad:', v.localidad);
  kv(M + 10, cy + 48, 'Condición frente al IVA:', 'Consumidor Final');
  kv(W / 2 + 8, cy + 16, 'Apellido y Nombre:', v.cliente);
  kv(W / 2 + 8, cy + 32, 'Teléfono:', v.telefono);

  // Tabla de productos
  doc.autoTable({
    startY: cy + 64,
    head: [['Código', 'Producto / Servicio', 'Cantidad', 'U. Medida', 'Precio unit.', '% Bonif', 'Imp. Bonif.', 'Subtotal']],
    body: (v.items || []).length
      ? (v.items || []).map(i => ['', i.nombre, Number(i.cant || 0).toFixed(3), 'Unidades', montoAR(i.precio), '0,00', '0,00', montoAR(i.precio * i.cant)])
      : [['', 'Sin ítems', '', '', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 3, lineColor: [210, 210, 210], lineWidth: 0.3 },
    headStyles: { fillColor: [240, 243, 244], textColor: 40, fontStyle: 'bold', lineColor: [70, 70, 70], lineWidth: 0.5 },
    columnStyles: { 0: { cellWidth: 50 }, 2: { halign: 'right' }, 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    margin: { left: M, right: M }, theme: 'grid'
  });

  // Totales al pie
  const piezas = (v.items || []).reduce((a, i) => a + Number(i.cant || 0), 0);
  const total = Number(v.total || 0);
  const iva = Number(v.iva || 0);
  const factura = v.factura === true;
  const grand = total + (factura ? iva : 0);
  const saldo = Number(v.saldo || 0);
  const recibido = grand - saldo;
  let y = Math.max(doc.lastAutoTable.finalY + 30, H - 175);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
  doc.text('Total piezas: ' + piezas, W - M, y, { align: 'right' }); y += 10;
  doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 16;
  const linea = (lbl, val, under) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(lbl, W - M - 115, y, { align: 'right' });
    doc.text(val, W - M, y, { align: 'right' });
    if (under) { doc.setLineWidth(0.6); doc.line(W - M - 72, y + 2, W - M, y + 2); }
    y += 16;
  };
  linea('Subtotal: ARS', montoAR(total));
  linea((factura ? 'IVA 21%: ARS' : 'Importe otros tributos: ARS'), montoAR(factura ? iva : 0));
  linea('Importe total: ARS', montoAR(grand), true);
  y += 4;
  linea('Total recibido: ARS', montoAR(recibido));
  linea('Saldo adeudado: ARS', montoAR(saldo), true);
  y += 10;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90);
  doc.text('Pag. 1/1', W / 2, y, { align: 'center' });
  y += 16; doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
  doc.text('Documento no válido como factura', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Aura Minipiscinas — Av. Rafael Núñez 3961, X5000 Córdoba — @Aura.minipiscinas', W / 2, H - 28, { align: 'center' });
  return Buffer.from(doc.output('arraybuffer'));
}

/* ====== CORREO (copy del equipo de Aura) ====== */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function emailHTML(v) {
  const nombre = esc((String(v.cliente || '').trim().split(' ')[0]) || 'cliente');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media (max-width:480px){.aura-pad{padding-left:24px!important;padding-right:24px!important}}</style></head>
<body style="margin:0;padding:0;background:#eef2f1;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f1;padding:26px 12px">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden">
    <tr><td class="aura-pad" style="padding:30px 40px 22px;text-align:center;border-bottom:1px solid #f0f3f2">
      <div style="font-size:30px;font-weight:700;letter-spacing:10px;color:#3f6f5e;font-family:Georgia,'Times New Roman',serif">AURA</div>
      <div style="font-size:10px;letter-spacing:6px;color:#9aa6a1;margin-top:4px">M I N I P I S C I N A S</div>
    </td></tr>
    <tr><td style="background:linear-gradient(135deg,#e9f5f2 0%,#dbefe9 100%);padding:30px 40px;text-align:center">
      <div style="font-size:23px;font-weight:800;color:#2b5347">¡Hola, ${nombre}!</div>
    </td></tr>
    <tr><td class="aura-pad" style="padding:28px 40px 6px">
      <p style="font-size:16px;line-height:1.7;color:#33403b;margin:0 0 16px">Tu orden ya está siendo preparada con todo el cuidado que se merece. En el remito adjunto encontrás el detalle completo de tu compra.</p>
      <p style="font-size:16px;line-height:1.7;color:#33403b;margin:0">Cuando esté lista, te avisamos. 😊</p>
    </td></tr>
    <tr><td class="aura-pad" style="padding:24px 40px 6px">
      <p style="font-size:15px;line-height:1.6;color:#33403b;margin:0 0 14px">¿Alguna consulta? Escribinos, estamos acá para ayudarte:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7faf9;border:1px solid #e8efec;border-radius:14px">
        <tr><td style="padding:16px 20px">
          <div style="font-size:14px;line-height:2.2;color:#33403b">
            <span style="display:inline-block;width:26px">📧</span><a href="mailto:adm.auraminipiscinas@gmail.com" style="color:#3f6f5e;text-decoration:none">adm.auraminipiscinas@gmail.com</a><br>
            <span style="display:inline-block;width:26px">📸</span><a href="https://instagram.com/Aura.minipiscinas" style="color:#3f6f5e;text-decoration:none">@Aura.minipiscinas</a><br>
            <span style="display:inline-block;width:26px">🌐</span><a href="https://www.minipiscinasaura.com" style="color:#3f6f5e;text-decoration:none">www.minipiscinasaura.com</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td class="aura-pad" style="padding:26px 40px 8px;text-align:center">
      <p style="font-size:15.5px;line-height:1.6;color:#2b5347;font-weight:700;margin:0">Gracias por elegirnos. ¡Hasta pronto!</p>
      <p style="font-size:14px;color:#7c8a85;margin:6px 0 0">El equipo de Aura</p>
    </td></tr>
    <tr><td style="padding:20px 40px 28px;text-align:center;border-top:1px solid #f0f3f2">
      ${v.vendedor ? `<div style="font-size:11.5px;color:#9aa6a1;line-height:1.6">Te atendió: ${esc(v.vendedor)}</div>` : ''}
      <div style="font-size:11px;color:#c4ccc9;margin-top:8px">Este es un correo automático; para cualquier consulta usá los canales de arriba.</div>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u || !u.user) return res.status(401).json({ error: 'Sesión no válida' });

    const { venta } = req.body || {};
    if (!venta || !venta.email) return res.status(400).json({ error: 'Falta el email del cliente' });

    // Adjunto 1: remito generado
    const pdf = generarPDF(venta);
    const attachments = [{ filename: `Venta_nro_${venta.nro}_Comprobante.pdf`, content: pdf }];

    // Adjunto 2: manual de usuario (uno para todos), tomado del sitio
    try {
      const r = await fetch(MANUAL_URL);
      if (r.ok) {
        const ab = await r.arrayBuffer();
        attachments.push({ filename: 'Manual_de_usuario_Aura.pdf', content: Buffer.from(ab) });
      }
    } catch (e) { /* si el manual no carga, igual mandamos el remito */ }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: `Aura Minipiscinas <${process.env.GMAIL_USER}>`,
      to: venta.email,
      subject: `Aura Minipiscinas · Tu compra (Venta N°${venta.nro})`,
      html: emailHTML(venta),
      attachments
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
