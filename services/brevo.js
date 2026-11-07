// ink-studio/services/brevo.js

// 1. Email sent to the Customer immediately after booking
export async function sendCustomerPendingEmail({ to, customerName, artistName, slotStart, reference }) {
  const body = {
    sender: { name: process.env.BREVO_SENDER_NAME, email: process.env.BREVO_SENDER_EMAIL },
    to: [{ email: to }],
    subject: `Appointment Request Received - ${reference} — Ink & Iron`,
    htmlContent: `
      <div style="font-family:Georgia,serif;background:#0A0A0A;color:#F5F1E8;padding:32px">
        <h1 style="color:#C9A227;margin:0 0 8px">Request Received</h1>
        <p>Hi ${customerName},</p>
        <p>We have received your appointment request for <strong>${artistName}</strong> on <strong>${slotStart}</strong>.</p>
        <p>Our team is currently verifying your payment. We will reach out to you with a confirmatory email within the next 24 hours.</p>
        <p>Your reference number is: <strong style="color:#E8622C;font-size:1.2rem;">${reference}</strong></p>
        <p style="color:#9A9488;font-size:12px;margin-top:30px;">If you have any questions, reply to this email.</p>
      </div>`
  };
  
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Brevo Error: ${await r.text()}`);
  return r.json();
}

// 2. Email sent to the Admin (Parlour) with screenshots attached
export async function sendAdminNotification({ adminEmail, reference, customerName, artistName, amount, screenshotBuffer, screenshotMime, referenceBuffer, referenceMime }) {
  const attachments = [];
  
  if (screenshotBuffer) {
    attachments.push({
      name: `payment-proof-${reference}.jpg`,
      content: screenshotBuffer.toString('base64')
    });
  }
  if (referenceBuffer) {
    attachments.push({
      name: `tattoo-reference-${reference}.jpg`,
      content: referenceBuffer.toString('base64')
    });
  }

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
        <p><em>Attached: Payment Screenshot & Tattoo Reference (if uploaded).</em></p>
      </div>
    `,
    attachment: attachments
  };

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!r.ok) throw new Error(`Brevo Error: ${await r.text()}`);
  return r.json();
}

// 3. Final Receipt (Sent when Admin clicks Confirm)
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
