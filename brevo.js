// services/brevo.js
export async function sendReceiptEmail({ to, adminEmail, pdfBase64, reference, amount, method, customerName, artistName, slotStart }) {
  const body = {
    sender: { name: process.env.BREVO_SENDER_NAME, email: process.env.BREVO_SENDER_EMAIL },
    to: [{ email: to }, { email: adminEmail }],
    subject: `Receipt ${reference} — Ink Studio`,
    htmlContent: `
      <div style="font-family:Georgia,serif;background:#0A0A0A;color:#F5F1E8;padding:32px">
        <h1 style="color:#C9A227;margin:0 0 8px">Payment Confirmed</h1>
        <p>Hi ${customerName},</p>
        <p>Your deposit of <strong style="color:#E8C766">$${amount.toFixed(2)} AUD</strong>
           for <strong>${artistName}</strong> on <strong>${slotStart}</strong> has been confirmed.</p>
        <p>Reference: <strong style="color:#E8622C">${reference}</strong><br>
           Method: ${method}</p>
        <p style="color:#9A9488;font-size:12px">Your receipt is attached as a PDF.</p>
      </div>`,
    attachment: [{ name: `receipt-${reference}.pdf`, content: pdfBase64 }]
  };
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
  return r.json();
}