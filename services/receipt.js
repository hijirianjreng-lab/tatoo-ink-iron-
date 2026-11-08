// ink-studio/services/receipt.js
import PDFDocument from 'pdfkit';

export function buildReceiptPdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      doc.on('error', reject);

      // Header
      doc.fillColor('#0A0A0A').fontSize(24).font('Helvetica-Bold').text('INK & IRON', { align: 'left' });
      doc.moveDown(0.3)
         .fillColor('#C9A227').fontSize(12).font('Helvetica')
         .text('Official Payment Receipt');

      doc.moveDown(2);

      // Table of details
      doc.fillColor('#000').fontSize(11);
      const rows = [
        ['Reference Number', data.reference],
        ['Customer', data.customerName],
        ['Artist', data.artistName],
        ['Session Date', new Date(data.slotStart).toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short' })],
        ['Payment Method', data.method],
        ['Amount Paid', `$${Number(data.amount).toFixed(2)} AUD`],
        ['Confirmed By', data.confirmedBy],
        ['Confirmed At', new Date(data.confirmedAt).toLocaleString('en-AU')]
      ];

      rows.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').text(`${label}: `, { continued: true })
           .font('Helvetica').text(String(value || '—'));
        doc.moveDown(0.4);
      });

      doc.moveDown(2);

      // Footer
      doc.fontSize(9).fillColor('#666666')
         .text(
           'This receipt confirms your deposit has been received and your session has been officially scheduled.',
           { align: 'center' }
         );

      doc.moveDown(0.5);
      doc.fontSize(8).fillColor('#999999')
         .text('breezy Ink & Iron Tattoo Studio', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
