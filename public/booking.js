// ink-studio/public/js/booking.js
const state = {
  artists: [],
  paymentMethods: [],
  settings: { currency_symbol: '$', currency_code: 'AUD' },
  selectedArtist: null,
  selectedSlot: null,      
  selectedMethod: null,
  step: 1
};

const $ = (id) => document.getElementById(id);
const toastContainer = $('toast-container');

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// Uses the dynamic symbol from the database
const money = (n) => `${state.settings.currency_symbol}${Number(n).toFixed(2)}`;

function formatSlot(iso) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function loadSetup() {
  try {
    const res = await fetch('/api/bookings/setup');
    if (!res.ok) throw new Error('Failed to load setup');
    const data = await res.json();
    
    console.log("Data received from server:", data);

    state.artists = data.artists || [];
    state.paymentMethods = data.paymentMethods || [];
    if (data.settings) state.settings = data.settings;

    if (state.artists.length === 0) {
      document.getElementById('artist-grid').innerHTML = '<p class="muted">No artists available. Add one in the admin panel.</p>';
    } else {
      renderArtistGallery();
      renderArtistChooser();
    }
    renderPaymentMethods();
  } catch (err) {
    toast('Could not load studio data. Please refresh.', 'error');
    console.error(err);
  }
}

function renderArtistGallery() {
  const grid = $('artist-grid');
  grid.innerHTML = state.artists.map(a => `
    <div class="artist-card" data-artist-id="${a.id}">
      <div class="artist-card__img" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-family:var(--font-display);font-size:1.1rem">
        ${escapeHtml(a.name)}
      </div>
      <div class="artist-card__body">
        <div class="artist-card__name">${escapeHtml(a.name)}</div>
        <div class="artist-card__rate">${money(a.hourly_rate)} / hour · Deposit ${money(a.deposit_amount)}</div>
        ${a.bio ? `<p class="card__body mt-1">${escapeHtml(a.bio)}</p>` : ''}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-artist-id]').forEach(card => {
    card.addEventListener('click', () => {
      selectArtist(Number(card.dataset.artistId));
      document.getElementById('book').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

function renderArtistChooser() {
  const grid = $('artist-select-grid');
  grid.innerHTML = state.artists.map(a => `
    <div class="artist-card" data-select-artist="${a.id}">
      <div class="artist-card__body">
        <div class="artist-card__name">${escapeHtml(a.name)}</div>
        <div class="artist-card__rate">${money(a.hourly_rate)} / hour</div>
        <div class="artist-card__rate mt-1">Deposit: <strong style="color:var(--gold-hi)">${money(a.deposit_amount)}</strong></div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-select-artist]').forEach(card => {
    card.addEventListener('click', () => selectArtist(Number(card.dataset.selectArtist)));
  });
}

function selectArtist(id) {
  state.selectedArtist = state.artists.find(a => a.id === id) || null;
  document.querySelectorAll('[data-select-artist]').forEach(c => {
    c.classList.toggle('artist-card--selected', Number(c.dataset.selectArtist) === id);
  });
  $('btn-step-1-next').disabled = !state.selectedArtist;
}

function goToStep(n) {
  state.step = n;
  for (let i = 1; i <= 4; i++) $(`panel-${i}`).classList.toggle('hidden', i !== n);
  $('panel-done').classList.add('hidden');
  document.querySelectorAll('.wizard-step').forEach(el => {
    const s = Number(el.dataset.step);
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
  window.scrollTo({ top: document.getElementById('book').offsetTop - 20, behavior: 'smooth' });
}

function initDatePicker() {
  const dateInput = $('booking-date');
  const today = new Date().toISOString().split('T')[0];
  dateInput.min = today;
  dateInput.addEventListener('change', () => loadAvailability(dateInput.value));
}

async function loadAvailability(date) {
  const grid = $('slot-grid');
  if (!state.selectedArtist) return;
  if (!date) {
    grid.innerHTML = '<p class="muted small">Select a date to see available times.</p>';
    return;
  }
  grid.innerHTML = '<p class="muted small">Loading times…</p>';

  try {
    const url = `/api/bookings/availability?artist_id=${state.selectedArtist.id}&date=${encodeURIComponent(date)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load availability');
    const data = await res.json();

    state.selectedSlot = null;
    $('btn-step-2-next').disabled = true;

    if (!data.free.length) {
      grid.innerHTML = '<p class="muted small">No free slots on this day. Try another date or another artist.</p>';
      return;
    }

    grid.innerHTML = data.free.map(slot => `
      <button type="button" class="slot" data-slot-start="${slot.slot_start}" data-slot-end="${slot.slot_end}">
        ${formatSlot(slot.slot_start)}
      </button>
    `).join('') + (data.taken.length ? data.taken.map(t => `
      <button type="button" class="slot taken" disabled>
        ${formatSlot(t.slot_start)}
      </button>
    `).join('') : '');

    grid.querySelectorAll('.slot:not(.taken)').forEach(btn => {
      btn.addEventListener('click', () => selectSlot(btn));
    });
  } catch (err) {
    toast('Could not load times.', 'error');
    console.error(err);
  }
}

function selectSlot(btn) {
  document.querySelectorAll('.slot').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.selectedSlot = {
    slot_start: btn.dataset.slotStart,
    slot_end: btn.dataset.slotEnd
  };
  $('btn-step-2-next').disabled = false;
}

function renderSummary() {
  if (!state.selectedArtist || !state.selectedSlot) return;
  $('summary-box').innerHTML = `
    <div class="flex-between">
      <span class="muted">Artist</span>
      <strong>${escapeHtml(state.selectedArtist.name)}</strong>
    </div>
    <div class="flex-between mt-1">
      <span class="muted">Date</span>
      <strong>${formatDate(state.selectedSlot.slot_start)}</strong>
    </div>
    <div class="flex-between mt-1">
      <span class="muted">Time</span>
      <strong>${formatSlot(state.selectedSlot.slot_start)} – ${formatSlot(state.selectedSlot.slot_end)}</strong>
    </div>
    <div class="flex-between mt-2" style="border-top:1px solid var(--border);padding-top:12px">
      <span class="muted">Deposit due</span>
      <strong style="color:var(--gold-hi);font-size:1.1rem">${money(state.selectedArtist.deposit_amount)}</strong>
    </div>
  `;
}

function renderPaymentMethods() {
  const box = $('payment-methods');
  if (!state.paymentMethods.length) {
    box.innerHTML = '<p class="muted">No payment methods configured. Contact the studio.</p>';
    return;
  }
  box.innerHTML = state.paymentMethods.map(m => `
    <div class="pay-method" data-method-id="${m.id}">
      <div class="pay-method__name">${escapeHtml(m.name)}</div>
      <div class="pay-method__details">
        ${m.instructions ? `<p style="margin-bottom:8px">${escapeHtml(m.instructions)}</p>` : ''}
        ${renderMethodFields(m.fields)}
      </div>
    </div>
  `).join('');

  box.querySelectorAll('[data-method-id]').forEach(el => {
    el.addEventListener('click', () => {
      box.querySelectorAll('.pay-method').forEach(p => p.classList.remove('selected'));
      el.classList.add('selected');
      state.selectedMethod = state.paymentMethods.find(m => m.id === Number(el.dataset.methodId));
    });
  });
}

function renderMethodFields(fields) {
  if (!fields || typeof fields !== 'object') return '';
  const labels = {
    bsb: 'BSB', account_name: 'Account name', account_number: 'Account number',
    reference_format: 'Reference', paypal_email: 'PayPal email', payid: 'PayID',
    email: 'Email', wallet_address: 'Wallet address', currency: 'Currency'
  };
  return Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `
      <div class="flex-between" style="padding:4px 0">
        <span style="color:var(--muted)">${escapeHtml(labels[k] || k)}</span>
        <strong>${escapeHtml(String(v))}</strong>
      </div>
    `).join('');
}

async function submitBooking() {
  const name = $('customer-name').value.trim();
  const email = $('customer-email').value.trim();
  const phone = $('customer-phone').value.trim();

  if (!name) return toast('Please enter your name.', 'error');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Please enter a valid email.', 'error');
  if (!state.selectedArtist) return toast('Please choose an artist.', 'error');
  if (!state.selectedSlot) return toast('Please choose a time slot.', 'error');
  if (!state.selectedMethod) return toast('Please choose a payment method.', 'error');

  const btn = $('btn-confirm-booking');
  btn.disabled = true;
  btn.textContent = 'Booking…';

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        artist_id: state.selectedArtist.id,
        customer_name: name,
        customer_email: email,
        customer_phone: phone || null,
        slot_start: state.selectedSlot.slot_start,
        slot_end: state.selectedSlot.slot_end,
        payment_method_id: state.selectedMethod.id
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        toast('That slot was just taken. Please choose another.', 'error');
        goToStep(2);
        loadAvailability($('booking-date').value);
      } else {
        toast(data.error || 'Booking failed.', 'error');
      }
      return;
    }

    showDone(data);
  } catch (err) {
    toast('Network error. Please try again.', 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Booking';
  }
}

function showDone(data) {
  for (let i = 1; i <= 4; i++) $(`panel-${i}`).classList.add('hidden');
  document.querySelectorAll('.wizard-step').forEach(el => {
    el.classList.remove('active');
    el.classList.add('done');
  });

  $('done-reference').textContent = data.reference;
  const method = state.selectedMethod;

  $('done-payment-details').innerHTML = `
    <h3 class="mb-2">${escapeHtml(method.name)}</h3>
    ${method.instructions ? `<p class="muted small mb-2">${escapeHtml(method.instructions)}</p>` : ''}
    ${renderMethodFields(method.fields)}
    <div class="flex-between mt-2" style="border-top:1px solid var(--border);padding-top:12px">
      <span class="muted">Amount to send</span>
      <strong style="color:var(--gold-hi);font-size:1.2rem">${money(data.amount)}</strong>
    </div>
    <p class="small mt-2" style="color:var(--orange)">
      Use <strong>${escapeHtml(data.reference)}</strong> as your payment reference.
    </p>
  `;

  $('panel-done').classList.remove('hidden');
  window.scrollTo({ top: document.getElementById('book').offsetTop - 20, behavior: 'smooth' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function wire() {
  $('btn-step-1-next').addEventListener('click', () => goToStep(2));
  $('btn-step-2-back').addEventListener('click', () => goToStep(1));
  $('btn-step-2-next').addEventListener('click', () => { renderSummary(); goToStep(3); });
  $('btn-step-3-back').addEventListener('click', () => goToStep(2));
  $('btn-step-3-next').addEventListener('click', () => {
    if (!state.selectedMethod && state.paymentMethods.length === 1) {
      state.selectedMethod = state.paymentMethods[0];
      const el = document.querySelector(`[data-method-id="${state.paymentMethods[0].id}"]`);
      if (el) el.classList.add('selected');
    }
    goToStep(4);
  });
  $('btn-step-4-back').addEventListener('click', () => goToStep(3));
  $('btn-confirm-booking').addEventListener('click', submitBooking);
  initDatePicker();
}

wire();
loadSetup();
