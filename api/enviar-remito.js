/* Función de servidor (Vercel) — Envía el remito por mail automáticamente.
   Genera el PDF y lo manda desde tu Gmail (Gmail SMTP con contraseña de app).
   Claves: GMAIL_USER, GMAIL_APP_PASSWORD (viven solo en el servidor). */
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

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

  // Datos del cliente (DNI, Localidad, Apellido y Nombre, Teléfono)
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

  // Totales al PIE de la hoja (el medio queda en blanco)
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u || !u.user) return res.status(401).json({ error: 'Sesión no válida' });

    const { venta, completo } = req.body || {};
    if (!venta || !venta.email) return res.status(400).json({ error: 'Falta el email del cliente' });

    const pdf = generarPDF(venta);
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });

    const frases = {
      'Presupuesto': 'Le acercamos el detalle de su presupuesto.',
      'Procesando pedido': 'Su orden está siendo preparada.',
      'En fabricación': 'Su pileta ya está en fabricación.',
      'Pedido Terminado': '¡Su pedido ya está terminado!',
      'Entregado al Cliente': '¡Su pedido fue entregado! Muchas gracias por su compra.',
      'En servicio de Post Venta': 'Su pedido está en servicio de post venta.'
    };
    const frase = frases[venta.estado] || 'Su orden está siendo preparada.';

    const subject = completo
      ? `Aura Minipiscinas — Tu compra (Venta N°${venta.nro})`
      : `Aura Minipiscinas — Comprobante de tu compra (Venta N°${venta.nro})`;

    const html = completo
      ? `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px">
          <p style="font-weight:700;font-size:18px">¡Gracias ${venta.cliente || ''}!</p>
          <p>${frase}</p>
          <p>Te dejamos adjunto el <b>comprobante</b> con el detalle completo de tu compra (Venta N°${venta.nro}).</p>
          <p style="color:#2f8aa0;font-weight:600">¡La factura digital colabora con el cuidado del medio ambiente!</p>
          <p style="font-size:12px;color:#5a6b73">Por favor no respondas este correo. Para contactarte con Aura Minipiscinas usá las vías habituales.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb">
          <p style="font-size:13px;color:#2c6fb5">Vendedor: ${venta.vendedor || ''}<br>Av. Rafael Núñez 3961, X5000 Córdoba — @Aura.minipiscinas</p>
        </div>`
      : `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937">
          <p style="font-weight:700">¡Gracias ${venta.cliente || ''}!</p>
          <p>${frase} En el comprobante adjunto encontrás el detalle de tu compra (remito).</p>
          <p>Ante cualquier consulta, comunicate con Aura Minipiscinas.<br>Av. Rafael Núñez 3961, X5000 Córdoba — @Aura.minipiscinas</p>
        </div>`;

    await transporter.sendMail({
      from: `Aura Minipiscinas <${process.env.GMAIL_USER}>`,
      to: venta.email,
      subject,
      html,
      attachments: [{ filename: `Venta_nro_${venta.nro}_Comprobante.pdf`, content: pdf }]
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
