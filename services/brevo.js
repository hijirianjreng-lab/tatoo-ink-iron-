// ink-studio/services/brevo.js

export async function sendReceiptEmail({ to, adminEmail, pdfBase64, reference, amount, method, customerName, artistName, slotStart }) {
  const body = {
    sender: { name: process.env.BREVO_SENDER_NAME, email: process.env.BREVO_SENDER_EMAIL },
    to: [{ email: to }, { email: adminEmail }],
    subject: `Receipt ${reference} — Ink & Iron`,
    htmlContent: `
      <div style="font-family:Georgia,serif;background:#0A0A0A;color:#F5F1E8;padding:32px">
        <h1 style="color:#C9A227;margin:0 0 8px">Payment Confirmed</h1>
        <p>Hi ${customerName},</p>
        <p>Your deposit of <strong style="color:#E8C766">$${Number(amount).toFixed(2)} AUD</strong>
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
  
  if (!r.ok) throw new Error(`Brevo Error: ${await r.text()}`);
  return r.json();
}

export async function sendAdminNotification({ adminEmail, reference, customerName, artistName, amount, screenshotBuffer, screenshotMime }) {
  const body = {
    sender: { name: process.env.BREVO_SENDER_NAME, email: process.env.BREVO_SENDER_EMAIL },
    to: [{ email: adminEmail }],
    subject: `🚨 New Booking - ${reference} (Action Required)`,
    htmlContent: `
      <div style="font-family:sans-serif; padding:20px;">
        <h2>New Pending Payment</h2>
        <p><strong>Reference:</strong> ${reference}</p>
        <p><strong>Customer:</strong> ${customerName}</p>
        <p><strong>Artist:</strong> ${artistName}</p>
        <p><strong>Amount:</strong> $${Number(amount).toFixed(2)}</p>
        <p>Log in to the Admin Panel to confirm this receipt.</p>
      </div>
    `,
    attachment: screenshotBuffer ? [{
      name: `payment-proof-${reference}.jpg`,
      content: screenshotBuffer.toString('base64')
    }] : []
  };

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!r.ok) throw new Error(`Brevo Error: ${await r.text()}`);
  return r.json();
}
