import PDFDocument from 'pdfkit';
export function buildReceiptPdf(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.fillColor('#0A0A0A').fontSize(24).text('INK STUDIO', { align: 'left' });
    doc.moveDown(0.3).fillColor('#C9A227').fontSize(12).text('Payment Receipt');
    doc.moveDown(1.5).fillColor('#000').fontSize(11);
    const rows = [
      ['Reference', data.reference], ['Customer', data.customerName],
      ['Artist', data.artistName], ['Session', data.slotStart],
      ['Method', data.method], ['Amount', `$${data.amount.toFixed(2)} AUD`],
      ['Confirmed by', data.confirmedBy], ['Confirmed at', data.confirmedAt]
    ];
    rows.forEach(([k, v]) => { doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(String(v)); });
    doc.end();
  });
}
