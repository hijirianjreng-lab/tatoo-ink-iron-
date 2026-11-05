// ink-studio/public/js/admin.js

/* ============ SESSION ============ */
const SESSION_KEY = 'ink_admin_session';

function getSession() {
  return sessionStorage.getItem(SESSION_KEY);
}
function setSession(sid) {
  sessionStorage.setItem(SESSION_KEY, sid);
}
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

async function api(path, options = {}) {
  const sid = getSession();
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (sid) headers['x-admin-session'] = sid;

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    clearSession();
    showLogin();
    throw new Error('Session expired. Please sign in again.');
  }
  return res;
}

/* ============ DOM ============ */
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
const money = (n) => `$${Number(n).toFixed(2)}`;

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/* ============ LOGIN / LOGOUT ============ */
function showLogin() {
  $('login-screen').classList.remove('hidden');
  $('panel-root').classList.add('hidden');
  $('admin-token').value = '';
}

function showPanel() {
  $('login-screen').classList.add('hidden');
  $('panel-root').classList.remove('hidden');
  loadPendingPayments();
  loadArtists();
  loadMethods();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('admin-token').value.trim();
  if (!token) return;
  const btn = $('login-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Invalid token.', 'error');
      return;
    }
    setSession(data.sessionId);
    showPanel();
    toast('Signed in.');
  } catch (err) {
    toast('Network error during login.', 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

$('logout-btn').addEventListener('click', () => {
  clearSession();
  showLogin();
});

/* ============ TABS ============ */
document.querySelectorAll('.admin-nav__item').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.admin-nav__item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    $(`tab-${tab}`).classList.remove('hidden');

    if (tab === 'payments') loadPendingPayments();
    if (tab === 'artists') loadArtists();
    if (tab === 'methods') loadMethods();
  });
});

/* ============ TAB 1: PENDING PAYMENTS ============ */
let pendingCache = [];

async function loadPendingPayments() {
  const wrap = $('payments-table-wrap');
  wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await api('/api/payments/pending');
    const data = await res.json();
    pendingCache = data.pending || [];
    renderPendingPayments();
  } catch (err) {
    wrap.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

function renderPendingPayments() {
  const wrap = $('payments-table-wrap');
  const badge = $('pending-count');

  if (!pendingCache.length) {
    wrap.innerHTML = '<div class="card text-center"><p class="muted">No pending payments. All clear.</p></div>';
    badge.classList.add('hidden');
    return;
  }

  badge.textContent = pendingCache.length;
  badge.classList.remove('hidden');

  wrap.innerHTML = `
    <div style="overflow-x:auto">
    <table class="admin-table">
      <thead>
        <tr>
          <th>Reference</th>
          <th>Customer</th>
          <th>Artist</th>
          <th>Session</th>
          <th>Method</th>
          <th>Amount</th>
          <th>Booked</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${pendingCache.map(p => `
          <tr>
            <td><strong style="color:var(--orange)">${escapeHtml(p.reference_number)}</strong></td>
            <td>
              ${escapeHtml(p.customer_name)}<br>
              <span class="muted small">${escapeHtml(p.customer_email)}</span>
            </td>
            <td>${escapeHtml(p.artist_name)}</td>
            <td>${formatDateTime(p.slot_start)}</td>
            <td>${escapeHtml(p.method_name)}</td>
            <td>${money(p.amount)}</td>
            <td class="muted small">${formatDateTime(p.created_at)}</td>
            <td>
              <div class="flex gap-1">
                <button class="btn btn--sm btn--accent" data-confirm="${p.id}">Confirm</button>
                <button class="btn btn--sm btn--danger" data-cancel="${p.id}">Cancel</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;

  wrap.querySelectorAll('[data-confirm]').forEach(b => {
    b.addEventListener('click', () => openConfirmModal(Number(b.dataset.confirm)));
  });
  wrap.querySelectorAll('[data-cancel]').forEach(b => {
    b.addEventListener('click', () => cancelPayment(Number(b.dataset.cancel)));
  });
}

/* ---- Confirm payment ---- */
let confirmTarget = null;

function openConfirmModal(paymentId) {
  const p = pendingCache.find(x => x.id === paymentId);
  if (!p) return;
  confirmTarget = p;
  $('confirm-summary').innerHTML = `
    <strong>${escapeHtml(p.reference_number)}</strong> —
    ${money(p.amount)} from ${escapeHtml(p.customer_name)}
    (${escapeHtml(p.method_name)}) for session on ${formatDateTime(p.slot_start)}
  `;
  $('confirm-note').value = '';
  $('confirm-modal').classList.add('open');
}

$('confirm-payment-btn').addEventListener('click', async () => {
  if (!confirmTarget) return;
  const btn = $('confirm-payment-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const note = $('confirm-note').value.trim();

  try {
    const res = await api(`/api/payments/${confirmTarget.id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Confirm failed.', 'error');
      return;
    }
    toast(`Receipt sent for ${data.reference}`);
    closeModal($('confirm-modal'));
    loadPendingPayments();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm & Send Receipt';
    confirmTarget = null;
  }
});

/* ---- Cancel payment ---- */
async function cancelPayment(paymentId) {
  if (!window.confirm('Cancel this booking and payment? This does not send any email.')) return;
  try {
    const res = await api(`/api/payments/${paymentId}/cancel`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Cancel failed.', 'error');
      return;
    }
    toast('Payment cancelled.');
    loadPendingPayments();
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('refresh-payments').addEventListener('click', loadPendingPayments);

/* ============ TAB 2: ARTISTS ============ */
let artistsCache = [];

async function loadArtists() {
  const wrap = $('artists-table-wrap');
  wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await api('/api/artists');
    const data = await res.json();
    artistsCache = data.artists || [];
    renderArtists();
  } catch (err) {
    wrap.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

function renderArtists() {
  const wrap = $('artists-table-wrap');
  if (!artistsCache.length) {
    wrap.innerHTML = '<div class="card text-center"><p class="muted">No artists yet.</p></div>';
    return;
  }
  wrap.innerHTML = `
    <div style="overflow-x:auto">
    <table class="admin-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Slug</th>
          <th>Hourly</th>
          <th>Deposit</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${artistsCache.map(a => `
          <tr>
            <td><strong>${escapeHtml(a.name)}</strong></td>
            <td class="muted small">${escapeHtml(a.slug)}</td>
            <td>${money(a.hourly_rate)}</td>
            <td>${money(a.deposit_amount)}</td>
            <td>
              <span class="badge ${a.is_active ? 'badge--confirmed' : 'badge--cancelled'}">
                ${a.is_active ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td>
              <div class="flex gap-1">
                <button class="btn btn--sm btn--ghost" data-edit-artist="${a.id}">Edit</button>
                <button class="btn btn--sm ${a.is_active ? 'btn--danger' : 'btn--accent'}"
                        data-toggle-artist="${a.id}">
                  ${a.is_active ? 'Disable' : 'Enable'}
                </button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;

  wrap.querySelectorAll('[data-edit-artist]').forEach(b => {
    b.addEventListener('click', () => openArtistModal(Number(b.dataset.editArtist)));
  });
  wrap.querySelectorAll('[data-toggle-artist]').forEach(b => {
    b.addEventListener('click', () => toggleArtist(Number(b.dataset.toggleArtist)));
  });
}

$('add-artist-btn').addEventListener('click', () => openArtistModal(null));

function openArtistModal(artistId) {
  const modal = $('artist-modal');
  const artist = artistId ? artistsCache.find(a => a.id === artistId) : null;

  $('artist-modal-title').textContent = artist ? 'Edit Artist' : 'Add Artist';
  $('artist-id').value = artist?.id || '';
  $('artist-name').value = artist?.name || '';
  $('artist-slug').value = artist?.slug || '';
  $('artist-bio').value = artist?.bio || '';
  $('artist-rate').value = artist?.hourly_rate ?? '';
  $('artist-deposit').value = artist?.deposit_amount ?? '';
  $('portfolio-file').value = '';

  if (artist) {
    loadPortfolio(artist.id);
  } else {
    $('portfolio-grid').innerHTML = '<p class="muted small">Save the artist first to add images.</p>';
  }

  modal.classList.add('open');
}

$('artist-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('artist-id').value;
  const payload = {
    name: $('artist-name').value.trim(),
    slug: $('artist-slug').value.trim(),
    bio: $('artist-bio').value.trim() || null,
    hourly_rate: Number($('artist-rate').value),
    deposit_amount: Number($('artist-deposit').value)
  };

  try {
    const res = id
      ? await api(`/api/artists/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/artists', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Save failed.', 'error');
      return;
    }
    toast(id ? 'Artist updated.' : 'Artist added.');
    if (!id && data.id) {
      // newly created — switch modal into edit mode so portfolio can be uploaded
      $('artist-id').value = data.id;
      $('artist-modal-title').textContent = 'Edit Artist';
      loadPortfolio(data.id);
      loadArtists();
    } else {
      closeModal($('artist-modal'));
      loadArtists();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function toggleArtist(id) {
  const artist = artistsCache.find(a => a.id === id);
  if (!artist) return;
  try {
    const res = await api(`/api/artists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: artist.is_active ? 0 : 1 })
    });
    if (!res.ok) {
      const data = await res.json();
      return toast(data.error || 'Update failed.', 'error');
    }
    toast(artist.is_active ? 'Artist disabled.' : 'Artist enabled.');
    loadArtists();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---- Portfolio ---- */
async function loadPortfolio(artistId) {
  const grid = $('portfolio-grid');
  grid.innerHTML = '<p class="muted small">Loading…</p>';
  try {
    const res = await api(`/api/artists/${artistId}/portfolio`);
    const data = await res.json();
    renderPortfolio(data.portfolio, artistId);
  } catch {
    grid.innerHTML = '<p class="muted small">Failed to load.</p>';
  }
}

function renderPortfolio(items, artistId) {
  const grid = $('portfolio-grid');
  if (!items.length) {
    grid.innerHTML = '<p class="muted small">No images yet.</p>';
    return;
  }
  grid.innerHTML = items.map(p => `
    <div style="position:relative">
      <img src="${escapeHtml(p.image_path)}" alt=""
           style="width:100%;height:120px;object-fit:cover;border:1px solid var(--border)">
      <button class="btn btn--sm btn--danger" data-del-portfolio="${p.id}"
              style="position:absolute;top:4px;right:4px;padding:4px 8px">×</button>
    </div>
  `).join('');

  grid.querySelectorAll('[data-del-portfolio]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Delete this image?')) return;
      const res = await api(`/api/artists/${artistId}/portfolio/${b.dataset.delPortfolio}`, { method: 'DELETE' });
      if (res.ok) { toast('Deleted.'); loadPortfolio(artistId); }
      else toast('Delete failed.', 'error');
    });
  });
}

$('upload-portfolio-btn').addEventListener('click', async () => {
  const artistId = $('artist-id').value;
  const fileInput = $('portfolio-file');
  if (!artistId) return toast('Save the artist first.', 'error');
  if (!fileInput.files.length) return toast('Choose an image.', 'error');

  const fd = new FormData();
  fd.append('image', fileInput.files[0]);

  const btn = $('upload-portfolio-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  try {
    const res = await fetch(`/api/artists/${artistId}/portfolio/upload`, {
      method: 'POST',
      headers: { 'x-admin-session': getSession() },
      body: fd
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Upload failed.', 'error');
    toast('Image uploaded.');
    fileInput.value = '';
    loadPortfolio(artistId);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
});

/* ============ TAB 3: PAYMENT METHODS ============ */
let methodsCache = [];

async function loadMethods() {
  const wrap = $('methods-table-wrap');
  wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await api('/api/payment-methods');
    const data = await res.json();
    methodsCache = data.methods || [];
    renderMethods();
  } catch (err) {
    wrap.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

function renderMethods() {
  const wrap = $('methods-table-wrap');
  if (!methodsCache.length) {
    wrap.innerHTML = '<div class="card text-center"><p class="muted">No payment methods configured.</p></div>';
    return;
  }
  wrap.innerHTML = `
    <div style="overflow-x:auto">
    <table class="admin-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Slug</th>
          <th>Fields</th>
          <th>Sort</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${methodsCache.map(m => `
          <tr>
            <td><strong>${escapeHtml(m.name)}</strong></td>
            <td class="muted small">${escapeHtml(m.slug)}</td>
            <td class="muted small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">
              ${escapeHtml(Object.keys(m.fields || {}).join(', ') || '—')}
            </td>
            <td>${m.sort_order}</td>
            <td>
              <span class="badge ${m.is_active ? 'badge--confirmed' : 'badge--cancelled'}">
                ${m.is_active ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td>
              <div class="flex gap-1">
                <button class="btn btn--sm btn--ghost" data-edit-method="${m.id}">Edit</button>
                <button class="btn btn--sm ${m.is_active ? 'btn--danger' : 'btn--accent'}"
                        data-toggle-method="${m.id}">
                  ${m.is_active ? 'Disable' : 'Enable'}
                </button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;

  wrap.querySelectorAll('[data-edit-method]').forEach(b => {
    b.addEventListener('click', () => openMethodModal(Number(b.dataset.editMethod)));
  });
  wrap.querySelectorAll('[data-toggle-method]').forEach(b => {
    b.addEventListener('click', () => toggleMethod(Number(b.dataset.toggleMethod)));
  });
}

$('add-method-btn').addEventListener('click', () => openMethodModal(null));

function openMethodModal(methodId) {
  const modal = $('method-modal');
  const m = methodId ? methodsCache.find(x => x.id === methodId) : null;

  $('method-modal-title').textContent = m ? 'Edit Payment Method' : 'Add Payment Method';
  $('method-id').value = m?.id || '';
  $('method-name').value = m?.name || '';
  $('method-slug').value = m?.slug || '';
  $('method-instructions').value = m?.instructions || '';
  $('method-fields').value = m ? JSON.stringify(m.fields || {}, null, 2) : '{}';
  $('method-sort').value = m?.sort_order ?? 0;

  modal.classList.add('open');
}

$('method-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('method-id').value;

  let fields;
  try {
    fields = JSON.parse($('method-fields').value || '{}');
    if (typeof fields !== 'object' || Array.isArray(fields)) throw new Error('must be object');
  } catch {
    return toast('Fields must be a valid JSON object.', 'error');
  }

  const payload = {
    name: $('method-name').value.trim(),
    slug: $('method-slug').value.trim(),
    instructions: $('method-instructions').value.trim() || null,
    fields,
    sort_order: Number($('method-sort').value)
  };

  try {
    const res = id
      ? await api(`/api/payment-methods/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/payment-methods', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Save failed.', 'error');
      return;
    }
    toast(id ? 'Method updated.' : 'Method added.');
    closeModal($('method-modal'));
    loadMethods();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function toggleMethod(id) {
  const m = methodsCache.find(x => x.id === id);
  if (!m) return;
  try {
    const res = await api(`/api/payment-methods/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: m.is_active ? 0 : 1 })
    });
    if (!res.ok) {
      const data = await res.json();
      return toast(data.error || 'Update failed.', 'error');
    }
    toast(m.is_active ? 'Method disabled.' : 'Method enabled.');
    loadMethods();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ============ MODAL CLOSE ============ */
function closeModal(modal) {
  modal.classList.remove('open');
}

document.querySelectorAll('[data-close-modal]').forEach(b => {
  b.addEventListener('click', () => closeModal(b.closest('.modal-backdrop')));
});

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal(backdrop);
  });
});

/* ============ BOOT ============ */
if (getSession()) {
  showPanel();
} else {
  showLogin();
}
