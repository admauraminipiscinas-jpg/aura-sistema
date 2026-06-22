/* Función de servidor (Vercel) — Envía el remito por mail automáticamente.
   Genera el PDF y lo manda desde tu Gmail (Gmail SMTP con contraseña de app).
   Claves: GMAIL_USER, GMAIL_APP_PASSWORD (viven solo en el servidor). */
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const montoAR = n => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function generarPDF(v) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), M = 40;
  doc.setLineWidth(1); doc.rect(M, M, W - 2 * M, 20);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('ORIGINAL', W / 2, M + 14, { align: 'center' });
  doc.setFontSize(18); doc.setTextColor(63, 111, 94); doc.text('AURA', M, M + 48);
  doc.setFontSize(8); doc.setTextColor(120); doc.text('MINIPISCINAS', M, M + 60);
  doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('Venta N°' + v.nro, W - M, M + 44, { align: 'right' });
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text('Vendedor: ' + (v.vendedor || ''), W - M, M + 60, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.text('Cliente: ', M, M + 84);
  doc.setFont('helvetica', 'normal'); doc.text(String(v.cliente || ''), M + 48, M + 84);
  autoTable(doc, {
    startY: M + 100,
    head: [['Producto / Servicio', 'Cant.', 'Precio unit.', 'Subtotal']],
    body: (v.items || []).map(i => [i.nombre, String(i.cant), montoAR(i.precio), montoAR(i.precio * i.cant)]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [63, 111, 94] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: M, right: M }, theme: 'grid'
  });
  let y = doc.lastAutoTable.finalY + 22;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Importe total: ARS ' + montoAR(v.total), W - M, y, { align: 'right' });
  y += 28; doc.setFontSize(9); doc.setTextColor(120);
  doc.text('Documento no válido como factura — Aura Minipiscinas', M, y);
  return Buffer.from(doc.output('arraybuffer'));
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

    const pdf = generarPDF(venta);
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
    await transporter.sendMail({
      from: `Aura Minipiscinas <${process.env.GMAIL_USER}>`,
      to: venta.email,
      subject: `Aura Minipiscinas — Comprobante de tu compra (Venta N°${venta.nro})`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937">
        <p style="font-weight:700">¡Gracias ${venta.cliente || ''}!</p>
        <p>Su orden está siendo preparada. En el comprobante adjunto encontrás el detalle de tu compra (remito).</p>
        <p>Ante cualquier consulta, comunicate con Aura Minipiscinas.<br>Av. Rafael Núñez 3961, X5000 Córdoba — @Aura.minipiscinas</p>
      </div>`,
      attachments: [{ filename: `Venta_nro_${venta.nro}_Comprobante.pdf`, content: pdf }]
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
