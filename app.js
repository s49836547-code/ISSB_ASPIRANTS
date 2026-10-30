/* ISSB ASPIRANTS frontend.
   Backend features activate after config.js and the Supabase SQL (supabase-schema.sql
   followed by supabase-schema-v2.sql) are applied. Nothing here pretends to save data
   when the backend is not configured. */
(() => {
  // ---------- Config & client ----------
  const cfg = window.ISSB_CONFIG || {};
  const configured = !!(window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('YOUR-') && !cfg.SUPABASE_ANON_KEY.includes('YOUR_'));
  const db = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  // ---------- Tiny helpers ----------
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'file';
  const fmtDate = d => d ? new Date(d).toLocaleDateString() : '';
  let toastTimer;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3800); }

  // ---------- State ----------
  let session = null, profile = null, currentPage = 'home';
  let notesCache = [], packagesCache = [], testsCache = [], announcementsCache = [], prCache = [], settings = {};
  let adminTab = 'overview';
  const notesView = { q: '', category: '', subject: '', access: '', page: 1 };
  const PAGE_SIZE = 9;
  const A = {}; // admin data cache, refreshed per admin render
  const STATUS_LABEL = { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended' };
  const statusLabel = s => STATUS_LABEL[s] || s || '—';

  const packageDefaults = [
    { id: 'verbal', name: 'Verbal Intelligence', price: 500, description: 'Practice material for verbal intelligence preparation.', features: ['Verbal practice resources', 'Access after payment approval', 'Lifetime access while entitlement remains active'] },
    { id: 'non-verbal', name: 'Non-Verbal Intelligence', price: 500, description: 'Visual and non-verbal reasoning preparation materials.', features: ['Non-verbal practice resources', 'Access after payment approval', 'Lifetime access while entitlement remains active'] },
    { id: 'academic', name: 'Academic Preparation', price: 700, description: 'Core academic preparation materials.', features: ['Academic study resources', 'Access after payment approval', 'Lifetime access while entitlement remains active'] },
    { id: 'complete', name: 'Complete Preparation', price: 1500, description: 'A combined preparation package for the full study journey.', features: ['Verbal + non-verbal resources', 'Academic preparation resources', 'Access after payment approval'], featured: true }
  ];

  const isAdmin = () => profile && ['owner', 'admin'].includes(profile.role);
  const isOwner = () => profile && profile.role === 'owner';
  const isApproved = () => profile && profile.status === 'approved';

  // ---------- Settings-driven content (owner-editable, with safe fallbacks) ----------
  const setting = (k, fb) => (settings && settings[k] != null) ? settings[k] : fb;
  const contactInfo = () => setting('contact', { whatsapp: '03319824359', easypaisa: '03472433655', channel_url: 'https://whatsapp.com/channel/0029VbBqGMj8qIzjSRWwHr1V' });
  // wa.me needs the INTERNATIONAL number with no leading 0, no '+', no spaces.
  // Accepts local Pakistani formats (0331..., +92331..., 0092331...) and normalizes to 92331...
  function waNumber(raw) {
    let d = String(raw || '').replace(/[^0-9]/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '92' + d.slice(1);
    else if (d.length === 10 && !d.startsWith('92')) d = '92' + d;
    return d;
  }
  const waLink = (raw) => { const n = waNumber(raw); return n ? `https://wa.me/${n}` : '#'; };
  const contributors = () => setting('contributors', [
    { name: 'Ahmad', role: 'Study material contributor & WhatsApp channel operator', bio: '' },
    { name: 'Najeebullah', role: 'Study material contributor & WhatsApp channel operator', bio: '' }
  ]);
  const paymentInstructions = () => (setting('payment_instructions', {}) || {}).text
    || `Send the exact package amount via EasyPaisa to ${contactInfo().easypaisa}, then submit your transaction reference (TID). Never send your PIN or password.`;

  // ---------- Shared UI fragments ----------
  function configNotice() { return `<div class="notice info"><strong>Backend setup needed:</strong> the public website UI is ready, but account, library and admin features need your Supabase project configured. Open <code>config.js</code> and follow <code>README.md</code>. Until then, forms will not pretend to save data.</div>`; }
  function pageHead(kicker, title, desc = '') { return `<div class="page-head"><span class="kicker">${esc(kicker)}</span><h1 class="page-title">${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}</div>`; }
  function empty(title, desc, icon = '⌁') { return `<div class="empty-state"><div class="icon-box">${icon}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`; }
  function buttonLink(page, label, cls = 'btn btn-primary') { return `<a class="${cls}" href="#${page}">${esc(label)} →</a>`; }
  function wrap(inner) { return `<div class="page-wrap"><div class="container">${inner}</div></div>`; }
  // Rejects after ms so a stalled network/auth call can never leave the spinner up forever.
  function withTimeout(promise, ms) { let t; return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('__timeout__')), ms); })]).finally(() => clearTimeout(t)); }
  // Refresh/confirm the auth token ONCE (serially) before firing many parallel queries.
  // Prevents concurrent token-refresh lock contention, which can stall pages opened from file://.
  async function ensureFreshSession() { if (db) { try { await db.auth.getSession(); } catch (_) { /* ignore */ } } }

  // ---------- Data loaders ----------
  async function loadSettings() { if (!db) return; const { data, error } = await db.from('site_settings').select('key,value'); if (error || !data) return; settings = {}; data.forEach(r => { settings[r.key] = r.value; }); }
  async function loadPackages() { if (!db) return; const { data, error } = await db.from('packages').select('id,name,description,price_pkr,active,status,features,sort_order').eq('active', true).order('sort_order'); if (!error) packagesCache = (data || []).map(p => ({ id: p.id, name: p.name, description: p.description, price: p.price_pkr, features: p.features || [], status: p.status, sort_order: p.sort_order })); }
  async function loadNotes() { if (!db) return; const { data, error } = await db.from('resources').select('id,title,description,category,subject,file_type,access_type,is_preview,package_id,published,created_at').eq('published', true).order('created_at', { ascending: false }); if (!error) notesCache = data || []; }
  async function loadPackageResources() { if (!db) return; const { data, error } = await db.from('package_resources').select('package_id,resource_id,is_preview'); if (!error) prCache = data || []; }
  async function loadTests() { if (!db) return; const { data, error } = await db.from('practice_tests').select('*').eq('published', true).order('created_at', { ascending: false }); if (!error) testsCache = data || []; }
  async function loadAnnouncements() { if (!db) return; const { data, error } = await db.from('announcements').select('*').eq('published', true).order('created_at', { ascending: false }); if (!error) announcementsCache = data || []; }
  const packagesForResource = (rid, legacyPid) => { const set = new Set(); if (legacyPid) set.add(legacyPid); prCache.forEach(pr => { if (pr.resource_id === rid) set.add(pr.package_id); }); return [...set]; };

  async function getResourceAccess() {
    const approved = isApproved();
    // Logged-out or not-yet-approved visitors: only FREE notes are shown.
    // Paid notes are hidden entirely (defense-in-depth on top of the RLS policy).
    if (!db || !session || !approved) return notesCache.filter(r => r.access_type === 'free').map(r => ({ ...r, has_access: false }));
    if (isAdmin()) return notesCache.map(r => ({ ...r, has_access: true }));
    const { data: ents } = await db.from('entitlements').select('package_id').eq('user_id', session.user.id).eq('active', true);
    const ids = new Set((ents || []).map(e => e.package_id));
    return notesCache
      .map(r => {
        if (r.access_type === 'free') return { ...r, has_access: true };
        return { ...r, has_access: packagesForResource(r.id, r.package_id).some(p => ids.has(p)) };
      })
      // A student only sees a PAID note if they actually own its package.
      .filter(r => r.access_type === 'free' || r.has_access);
  }

  // ---------- Public pages ----------
  function renderHome() {
    const c = contactInfo();
    return `<section class="hero"><div class="hero-inner"><span class="eyebrow">✦ Structured preparation · Independent resources</span><h1>Prepare with purpose.<br><span>Perform with confidence.</span></h1><p>Explore ISSB preparation notes, intelligence practice resources, academic material and curated mock tests — organised to help you prepare with consistency.</p><div class="actions">${buttonLink('auth', 'Create Student Account')}${buttonLink('packages', 'Explore Packages', 'btn btn-secondary')}</div><div class="stat-row"><div class="stat"><strong>01</strong><span>Register and verify your email</span></div><div class="stat"><strong>02</strong><span>Wait for account approval</span></div><div class="stat"><strong>03</strong><span>Access eligible resources</span></div></div></div></section>
    <section class="section"><div class="container"><div class="section-head center"><span class="kicker">Your preparation hub</span><h2>Everything organised in one place.</h2><p>Browse resources, choose a preparation package, and track your access from your student account.</p></div><div class="grid grid-3"><article class="card"><div class="icon-box">▤</div><h3>Study notes</h3><p>Find resources by category and access level. Protected files require an approved account and the correct entitlement.</p></article><article class="card"><div class="icon-box">◈</div><h3>Practice tests</h3><p>Use curated practice links for verbal, non-verbal and academic preparation when published by the academy.</p></article><article class="card"><div class="icon-box">✓</div><h3>Clear access process</h3><p>Email verification, owner approval and manual payment verification help keep account access controlled.</p></article></div></div></section>
    <section class="section band"><div class="container grid grid-3" style="align-items:center"><div class="section-head"><span class="kicker">Start here</span><h2>Choose a path that fits your preparation.</h2><p>Public visitors can view the package catalogue. Materials are made available only after the required account and payment checks.</p></div><div class="card"><h3>Free resources</h3><p>Register, verify your email and wait for approval to access materials marked free.</p><div class="form-actions">${buttonLink('free-notes', 'View free notes', 'btn btn-outline')}</div></div><div class="card"><h3>Premium packages</h3><p>Select a package, submit your EasyPaisa payment reference and wait for manual verification.</p><div class="form-actions">${buttonLink('packages', 'View packages', 'btn btn-primary')}</div></div></div></section>
    <section class="section"><div class="container"><div class="notice info"><strong>Independent platform:</strong> ISSB ASPIRANTS is a preparation resource platform and is not an official ISSB or armed forces website. No selection outcome is guaranteed. <a class="channel-link" href="${esc(c.channel_url)}" target="_blank" rel="noopener noreferrer">Join the WhatsApp channel ↗</a></div></div></section>`;
  }

  function renderAbout() {
    const c = contactInfo(), contribs = contributors();
    return wrap(`${pageHead('About the academy', 'A focused place for ISSB preparation', 'ISSB ASPIRANTS organises preparation materials and practice resources for candidates who want a more structured study routine.')}
    <div class="grid grid-3"><article class="card"><div class="icon-box">◎</div><h3>Our approach</h3><p>Keep study materials organised, make access rules clear, and encourage regular practice and independent learning.</p></article><article class="card"><div class="icon-box">▤</div><h3>Resource categories</h3><p>Verbal intelligence, non-verbal intelligence, academic preparation and general study resources.</p></article><article class="card"><div class="icon-box">✦</div><h3>Lifetime access</h3><p>Purchased packages remain active until the owner revokes them. There is no automatic expiry in this version.</p></article></div>
    <div class="section-head" style="margin-top:34px"><span class="kicker">Our material contributors</span><h2>People behind the resources</h2><p>These contributors supply study materials and operate the linked WhatsApp channel. They are platform owners and administrators.</p></div>
    <div class="grid grid-2">${contribs.map(p => `<article class="card"><div class="icon-box">👤</div><h3>${esc(p.name || '')}</h3><p><strong>${esc(p.role || 'Contributor')}</strong></p>${p.bio ? `<p style="margin-top:8px">${esc(p.bio)}</p>` : ''}</article>`).join('')}</div>
    <div class="form-actions" style="margin-top:18px"><a class="btn btn-primary" href="${esc(c.channel_url)}" target="_blank" rel="noopener noreferrer">Join WhatsApp channel ↗</a></div>
    <div class="notice info" style="margin-top:22px">ISSB ASPIRANTS is an independent preparation platform. It does not claim official affiliation, access to selection boards, or guaranteed selection.</div>`);
  }

  function renderPackages() {
    const list = packagesCache.length ? packagesCache : packageDefaults;
    return wrap(`${pageHead('Packages', 'Preparation packages', 'Package prices are shown publicly. Access is granted only after the account and payment have been checked.')}
    <div class="grid grid-4">${list.map((p, i) => `<article class="card ${p.featured || p.id === 'complete' ? 'featured-card' : ''}"><span class="pill">${i === 3 ? 'COMPLETE' : 'PREPARATION'}</span><h3>${esc(p.name)}</h3><p>${esc(p.description || 'Preparation resources for this category.')}</p><div class="price">${money(p.price)} <small>/ lifetime entitlement*</small></div><ul class="features">${(p.features || ['Access after account approval', 'Manual payment verification', 'Owner-controlled access']).map(f => `<li>${esc(f)}</li>`).join('')}</ul><button class="btn btn-primary" data-buy="${esc(p.id)}" data-name="${esc(p.name)}">Request this package →</button></article>`).join('')}</div>
    <p class="form-note">*Lifetime entitlement applies while the package access remains active. Access may be revoked for administrative or policy reasons. EasyPaisa payments are manually verified; submitting a screenshot alone does not guarantee approval.</p>`);
  }

  async function renderTests() {
    // Fetch fresh so a newly published test shows without a full page reload.
    if (db) { const { data, error } = await db.from('practice_tests').select('*').eq('published', true).order('created_at', { ascending: false }); if (!error) testsCache = data || []; }
    return wrap(`${pageHead('Practice', 'Practice tests', 'External practice links are published by the academy team. Check the destination before entering personal information.')}
    <div class="grid grid-3">${testsCache.length ? testsCache.map(t => `<article class="card resource-card"><span class="tag">${esc(t.category || 'General')}</span><h3>${esc(t.title)}</h3><p>${esc(t.description || 'Practice resource')}</p><a class="btn btn-primary" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Open test ↗</a><p class="form-note" style="margin-top:8px;word-break:break-all">${esc(t.url)}</p></article>`).join('') : empty('Practice tests coming soon', 'No test links have been published yet. Please check again later.', '◈')}</div>`);
  }

  async function renderAnnouncements() {
    // Fetch fresh so a newly published announcement shows without a full page reload.
    if (db) { const { data, error } = await db.from('announcements').select('*').eq('published', true).order('created_at', { ascending: false }); if (!error) announcementsCache = data || []; }
    return wrap(`${pageHead('Updates', 'Announcements', 'Updates published by the ISSB ASPIRANTS team.')}
    <div class="grid">${announcementsCache.length ? announcementsCache.map(a => `<article class="card"><span class="kicker">${fmtDate(a.created_at)}</span><h3>${esc(a.title)}</h3><p style="white-space:pre-wrap">${esc(a.body)}</p></article>`).join('') : empty('No announcements yet', 'New updates will appear here when published.', '◷')}</div>`);
  }

  function renderContact() {
    const c = contactInfo();
    return wrap(`${pageHead('Support', 'Contact the academy', 'Send a message or contact the academy directly on WhatsApp.')}
    <div class="grid grid-3"><div class="card"><div class="icon-box">☏</div><h3>WhatsApp support</h3><p>${esc(c.whatsapp)}</p><div class="form-actions"><a class="btn btn-primary" href="${waLink(c.whatsapp)}" target="_blank" rel="noopener noreferrer">Message us ↗</a></div></div><div class="card"><div class="icon-box">↗</div><h3>WhatsApp channel</h3><p>Follow channel updates and shared announcements.</p><div class="form-actions"><a class="btn btn-outline" href="${esc(c.channel_url)}" target="_blank" rel="noopener noreferrer">Join channel ↗</a></div></div><div class="card"><div class="icon-box">₨</div><h3>EasyPaisa</h3><p>Payment number: <strong>${esc(c.easypaisa)}</strong></p><p class="form-note">Do not send payments until you have selected a package and confirmed the current payment instructions with the academy.</p></div></div>
    <form id="contact-form" class="form-card" style="margin-top:24px"><h2>Send a message</h2><p class="muted">Your contact details are stored only so the academy can reply to your request. They are not shared publicly.</p><div class="form-grid"><div class="field"><label for="contact-name">Name</label><input id="contact-name" name="name" required maxlength="100" autocomplete="name"></div><div class="field"><label for="contact-email">Email</label><input id="contact-email" name="email" type="email" required maxlength="254" autocomplete="email"></div><div class="field full"><label for="contact-subject">Subject</label><input id="contact-subject" name="subject" required maxlength="150"></div><div class="field full"><label for="contact-message">Message</label><textarea id="contact-message" name="message" required maxlength="3000"></textarea></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Send message →</button></div></form>`);
  }

  // ---------- Notes library (search + filters + pagination) ----------
  async function renderNotes(freeOnly = false) {
    const resources = await getResourceAccess();
    const cats = [...new Set(resources.map(r => r.category).filter(Boolean))].sort();
    const subs = [...new Set(resources.map(r => r.subject).filter(Boolean))].sort();
    let list = resources.slice();
    if (freeOnly) list = list.filter(r => r.access_type === 'free');
    if (notesView.q) { const q = notesView.q.toLowerCase(); list = list.filter(r => (r.title + ' ' + (r.description || '') + ' ' + (r.category || '') + ' ' + (r.subject || '')).toLowerCase().includes(q)); }
    if (notesView.category) list = list.filter(r => r.category === notesView.category);
    if (notesView.subject) list = list.filter(r => r.subject === notesView.subject);
    if (notesView.access) list = list.filter(r => r.access_type === notesView.access);
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (notesView.page > totalPages) notesView.page = totalPages;
    const pageItems = list.slice((notesView.page - 1) * PAGE_SIZE, notesView.page * PAGE_SIZE);
    const lockLabel = r => !session ? 'Sign in to access' : !isApproved() ? (profile && profile.status === 'suspended' ? 'Account suspended' : 'Approval required') : r.access_type === 'paid' ? 'Package required' : 'Access restricted';
    const cards = pageItems.map(r => `<article class="card resource-card"><div class="resource-meta"><span class="tag">${esc(r.category || 'General')}</span>${r.subject ? `<span class="tag">${esc(r.subject)}</span>` : ''}<span class="tag ${r.access_type === 'free' ? 'free' : 'paid'}">${r.access_type === 'free' ? 'FREE' : 'PREMIUM'}</span>${r.is_preview ? '<span class="tag">PREVIEW</span>' : ''}</div><h3>${esc(r.title)}</h3><p>${esc(r.description || 'Study resource published by ISSB ASPIRANTS.')}</p>${r.has_access ? `<button class="btn btn-primary" data-download="${esc(r.id)}">Secure download ↗</button>` : `<button class="btn btn-outline" data-restricted="${esc(r.id)}">${lockLabel(r)}</button>`}</article>`).join('');
    const pager = totalPages > 1 ? `<div class="form-actions" style="justify-content:center;margin-top:20px">${Array.from({ length: totalPages }, (_, i) => `<button class="btn ${notesView.page === i + 1 ? 'btn-primary' : 'btn-outline'}" data-page="${i + 1}">${i + 1}</button>`).join('')}</div>` : '';
    const notice = !session ? 'Sign in and get your account approved to access files.' : !isApproved() ? (profile && profile.status === 'suspended' ? 'Your account is suspended. Contact the academy to restore access.' : 'Your account must be approved before resource downloads are enabled.') : 'Select an eligible resource to request a secure download.';
    return wrap(`${pageHead(freeOnly ? 'Free library' : 'Study resources', 'Notes Library', freeOnly ? 'Free notes still require a verified email and an approved student account.' : 'Browse the published catalogue. Restricted PDFs are served only to approved students with the required access.')}
    <div class="notice info" style="margin-bottom:18px">${notice}</div>
    ${!resources.length ? empty('No published resources yet', 'The catalogue will populate when the owner publishes materials.', '▤') : `
      <div class="filter-bar"><input type="search" id="notes-q" placeholder="Search title, category, subject…" value="${esc(notesView.q)}">
        <select id="notes-category"><option value="">All categories</option>${cats.map(c => `<option ${notesView.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="notes-subject"><option value="">All subjects</option>${subs.map(s => `<option ${notesView.subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        ${freeOnly ? '' : `<select id="notes-access"><option value="">Free & paid</option><option value="free" ${notesView.access === 'free' ? 'selected' : ''}>Free only</option><option value="paid" ${notesView.access === 'paid' ? 'selected' : ''}>Paid only</option></select>`}
      </div>
      ${list.length ? `<div class="grid grid-3">${cards}</div>${pager}` : empty('No matches', 'No resources match your current search or filters.', '⌕')}
      <p class="form-note">Showing ${list.length} resource${list.length === 1 ? '' : 's'}${freeOnly ? ' (free only)' : ''}.</p>`}`);
  }

  // ---------- Auth ----------
  function renderAuth() {
    return wrap(`${pageHead('Student portal', 'Create your student account', 'Registration has exactly four fields. You must verify your email and then wait for owner approval before accessing notes.')}
    <div class="form-card"><div class="tabs"><button class="tab active" data-auth-mode="login">Login</button><button class="tab" data-auth-mode="register">Create account</button></div><div id="auth-notice">${configured ? '' : '<div style="margin-bottom:16px">' + configNotice() + '</div>'}</div>
    <form id="auth-form"><div id="register-fields" class="form-grid hidden"><div class="field full"><label for="full-name">Full name</label><input id="full-name" name="full_name" maxlength="120" autocomplete="name"></div><div class="field full"><label for="phone">Phone / WhatsApp</label><input id="phone" name="phone" type="tel" maxlength="30" autocomplete="tel" placeholder="03xx xxxxxxx"></div></div><div class="field" style="margin-top:12px"><label for="email">Email address</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="email"></div><div class="field" style="margin-top:12px"><label for="password">Password</label><input id="password" name="password" type="password" required minlength="8" autocomplete="current-password"><span class="form-note">Use at least 8 characters. Never share your password.</span></div><div class="form-actions"><button class="btn btn-primary" type="submit" id="auth-submit">Login →</button><button class="btn btn-outline" type="button" id="forgot-password">Forgot password?</button></div><p class="form-note">Registration is not complete until you verify your email. Owner approval is a separate step.</p></form></div>`);
  }

  // ---------- Student dashboard ----------
  async function renderDashboard() {
    if (!session) return wrap(`${pageHead('Student portal', 'Please sign in', 'You need to log in to view your student dashboard.')}${buttonLink('auth', 'Go to login')}`);
    if (!profile) return wrap(`${pageHead('Student portal', 'Profile not ready', configured ? 'Your account profile could not be loaded. This is usually a temporary connection issue — try again, or sign out and log back in.' : 'Your account profile could not be loaded.')}<div class="form-actions"><button class="btn btn-primary" id="retry-render">Try again</button><button class="btn btn-outline" id="logout-btn">Sign out</button></div>${configured ? '' : '<div style="margin-top:20px">' + configNotice() + '</div>'}`);
    const me = profile, user = session.user; // snapshot: onAuthStateChange can null these mid-render
    const status = me.status || 'pending';
    const c = contactInfo();
    if (db) await ensureFreshSession();
    let ent = [];
    if (db && status === 'approved') { const q = await db.from('entitlements').select('id,package_id,active,packages(name)').eq('user_id', user.id).eq('active', true); if (!q.error) ent = q.data || []; }
    let myPayments = [];
    if (db) { const q = await db.from('payment_requests').select('id,package_id,package_name_snapshot,amount_pkr,status,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10); if (!q.error) myPayments = q.data || []; }
    const banner = status === 'approved' ? '' : status === 'rejected'
      ? `<div class="notice error" style="margin-bottom:20px"><strong>Account status: Rejected.</strong> Your account was not approved. Please contact the academy on WhatsApp (${esc(c.whatsapp)}) for clarification.</div>`
      : status === 'suspended'
        ? `<div class="notice error" style="margin-bottom:20px"><strong>Account status: Suspended.</strong> Protected resources are paused. Contact the academy on WhatsApp (${esc(c.whatsapp)}) to discuss restoration.</div>`
        : `<div class="notice info" style="margin-bottom:20px"><strong>Account status: Pending.</strong> Verify your email if you have not already, then wait for owner approval. Free and premium resources remain locked until approval.</div>`;
    return wrap(`<div class="dashboard-top"><div><span class="eyebrow">Student dashboard</span><h1>Welcome, ${esc(me.full_name || user.email)}</h1><p>${esc(user.email)} · Your account and resource access at a glance.</p></div><div><span class="status ${esc(status)}">${esc(statusLabel(status))}</span><div class="form-actions"><button class="btn btn-secondary" id="logout-btn">Sign out</button></div></div></div>
    ${banner}
    <div class="grid grid-3"><article class="card"><span class="kicker">Account</span><h3>${esc(statusLabel(status))}</h3><p>Email confirmation: ${user.email_confirmed_at ? 'Verified' : 'Not verified yet'}</p><div class="form-actions"><button class="btn btn-outline" id="reset-password-btn">Send password reset</button></div></article><article class="card"><span class="kicker">Active packages</span><h3>${ent.length}</h3><p>Only packages granted by the owner appear here.</p></article><article class="card"><span class="kicker">Support</span><h3>Need help?</h3><p>Message the academy on WhatsApp.</p><div class="form-actions"><a class="btn btn-outline" href="${waLink(c.whatsapp)}" target="_blank" rel="noopener noreferrer">Contact support ↗</a></div></article></div>
    <section class="section" style="padding-bottom:0"><div class="section-head"><h2>Your packages</h2></div>${ent.length ? `<div class="grid grid-3">${ent.map(e => `<article class="card"><span class="status approved">Active</span><h3>${esc(e.packages?.name || 'Preparation package')}</h3><p>Lifetime access is currently active.</p></article>`).join('')}</div>` : empty('No active packages', 'Purchase requests that are verified and approved by the owner will appear here.', '▤')}<div class="form-actions">${buttonLink('packages', 'Explore packages')}${buttonLink('free-notes', 'Free notes', 'btn btn-outline')}${buttonLink('notes', 'Browse notes', 'btn btn-outline')}</div></section>
    <section class="section" style="padding-bottom:0"><div class="section-head"><h2>Your payment requests</h2></div>${myPayments.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Package</th><th>Amount</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${myPayments.map(p => `<tr><td>${esc(p.package_name_snapshot || p.package_id)}</td><td>${money(p.amount_pkr)}</td><td><span class="status ${esc(p.status)}">${esc(p.status)}</span></td><td>${fmtDate(p.created_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No payment requests yet', 'When you request a package, its verification status will appear here.', '₨')}</section>`);
  }

  // ================= ADMIN DASHBOARD =================
  const ADMIN_TABS = [
    ['overview', 'Overview', '▦'], ['students', 'Students', '👥'], ['packages', 'Packages', '▣'],
    ['payments', 'Payments', '₨'], ['resources', 'Notes & PDFs', '▤'], ['tests', 'Practice tests', '◈'],
    ['announcements', 'Announcements', '◷'], ['contact', 'Contact inbox', '✉'], ['settings', 'Settings', '⚙']
  ];

  async function countWhere(table, conds) {
    if (!db) return 0;
    let q = db.from(table).select('*', { count: 'exact', head: true });
    (conds || []).forEach(([col, op, val]) => { q = q.filter(col, op, val); });
    const { count, error } = await q;
    return error ? 0 : (count || 0);
  }

  async function loadAdminData(tab) {
    if (!db) return;
    await ensureFreshSession();
    if (tab === 'overview') {
      const [students, pending, approved, suspended, rejected, pubs, pkgs, pays, logs] = await Promise.all([
        countWhere('profiles', [['role', 'eq', 'student']]),
        countWhere('profiles', [['role', 'eq', 'student'], ['status', 'eq', 'pending']]),
        countWhere('profiles', [['role', 'eq', 'student'], ['status', 'eq', 'approved']]),
        countWhere('profiles', [['role', 'eq', 'student'], ['status', 'eq', 'suspended']]),
        countWhere('profiles', [['role', 'eq', 'student'], ['status', 'eq', 'rejected']]),
        countWhere('resources', [['published', 'eq', true]]),
        countWhere('packages', [['status', 'eq', 'published']]),
        countWhere('payment_requests', [['status', 'eq', 'pending']]),
        db.from('audit_logs').select('action,target_type,details,created_at').order('created_at', { ascending: false }).limit(8)
      ]);
      A.stats = { students, pending, approved, suspended, rejected, pubs, pkgs, pays };
      A.logs = logs.data || [];
    }
    if (tab === 'students') {
      const [users, ents, pkgs] = await Promise.all([
        db.from('profiles').select('id,full_name,phone,status,role,created_at').order('created_at', { ascending: false }).limit(500),
        db.from('entitlements').select('user_id,package_id,active,packages(name)'),
        db.from('packages').select('id,name').order('sort_order')
      ]);
      A.users = users.data || []; A.ents = ents.data || []; A.pkgs = pkgs.data || [];
    }
    if (tab === 'packages') { const q = await db.from('packages').select('*').order('sort_order'); A.packages = q.data || []; }
    if (tab === 'payments') { const q = await db.from('payment_requests').select('id,user_id,package_id,package_name_snapshot,transaction_ref,amount_pkr,status,created_at,reviewed_at,receipt_path').order('created_at', { ascending: false }).limit(200); A.payments = q.data || []; }
    if (tab === 'resources') { const [res, pkgs] = await Promise.all([db.from('resources').select('id,title,category,subject,file_type,access_type,is_preview,package_id,published,storage_path,created_at').order('created_at', { ascending: false }).limit(500), db.from('packages').select('id,name').order('sort_order')]); A.resources = res.data || []; A.pkgs = pkgs.data || []; await loadPackageResources(); }
    if (tab === 'tests') { const q = await db.from('practice_tests').select('*').order('created_at', { ascending: false }).limit(200); A.tests = q.data || []; }
    if (tab === 'announcements') { const q = await db.from('announcements').select('*').order('created_at', { ascending: false }).limit(200); A.announcements = q.data || []; }
    if (tab === 'contact') { const q = await db.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(200); A.messages = q.data || []; }
    if (tab === 'settings') { await loadSettings(); }
  }

  function adminNav() {
    return `<div class="side-head"><span class="brand-fallback">IA</span><div><strong>Control centre</strong><small>${isOwner() ? 'Owner' : 'Administrator'}</small></div></div>
    <nav class="admin-nav">${ADMIN_TABS.map(([id, label, icon]) => `<button data-admin-tab="${id}" class="${adminTab === id ? 'active' : ''}"><span>${icon}</span>${esc(label)}</button>`).join('')}</nav>`;
  }

  function statCard(n, label, tone = '') { return `<div class="stat-card ${tone}"><strong>${Number(n || 0)}</strong><span>${esc(label)}</span></div>`; }

  function adminOverview() {
    const s = A.stats || {};
    return `<section class="admin-panel"><h2>Overview</h2><p class="muted">Real figures from your database. Nothing here is hardcoded.</p>
    <div class="stat-grid">${statCard(s.students, 'Registered students')}${statCard(s.pending, 'Pending applications', 'amber')}${statCard(s.approved, 'Approved', 'green')}${statCard(s.suspended, 'Suspended', 'red')}${statCard(s.rejected, 'Rejected')}${statCard(s.pubs, 'Published resources')}${statCard(s.pkgs, 'Published packages')}${statCard(s.pays, 'Payments to review', 'amber')}</div>
    <h3 style="margin-top:26px">Recent administrative activity</h3>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Action</th><th>Target</th><th>Details</th><th>When</th></tr></thead><tbody>${(A.logs || []).map(l => `<tr><td>${esc(l.action)}</td><td>${esc(l.target_type || '—')}</td><td class="muted">${esc(JSON.stringify(l.details || {}))}</td><td>${fmtDate(l.created_at)}</td></tr>`).join('') || '<tr><td colspan="4">No activity recorded yet.</td></tr>'}</tbody></table></div></section>`;
  }

  function adminStudents() {
    const users = A.users || [], ents = A.ents || [], pkgs = A.pkgs || [];
    const entFor = uid => ents.filter(e => e.user_id === uid && e.active).map(e => e.packages?.name || e.package_id);
    const rows = users.map(u => {
      const isStudent = u.role === 'student';
      const mine = entFor(u.id);
      let actions = '—';
      if (isStudent) {
        const btns = [];
        if (u.status !== 'approved') btns.push(`<button class="btn btn-outline" data-user-action="${esc(u.id)}" data-status="approved">Approve</button>`);
        if (u.status !== 'rejected') btns.push(`<button class="btn btn-danger" data-user-action="${esc(u.id)}" data-status="rejected">Reject</button>`);
        if (u.status === 'approved') btns.push(`<button class="btn btn-danger" data-user-action="${esc(u.id)}" data-status="suspended">Suspend</button>`);
        if (u.status === 'suspended') btns.push(`<button class="btn btn-outline" data-user-action="${esc(u.id)}" data-status="approved">Restore</button>`);
        actions = `<div class="row-actions">${btns.join('')}</div>`;
      }
      return `<tr data-searchrow="${esc((u.full_name || '') + ' ' + (u.phone || '') + ' ' + u.status)}"><td>${esc(u.full_name || '—')}</td><td>${esc(u.phone || '—')}</td><td><span class="status ${esc(u.status)}">${esc(u.status)}</span></td><td>${esc(u.role)}</td><td class="muted">${mine.length ? mine.map(esc).join(', ') : (isStudent ? 'None' : '—')}</td><td>${fmtDate(u.created_at)}</td><td>${actions}</td></tr>`;
    }).join('');
    return `<section class="admin-panel"><h2>Student management</h2><p class="muted">Approve only after checking the account. Approval requires a verified email (enforced by the database). Suspend instantly removes protected access.</p>
    <div class="filter-bar"><input type="search" id="student-search" placeholder="Search name, phone or status…"></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Contact</th><th>Status</th><th>Role</th><th>Packages</th><th>Joined</th><th>Actions</th></tr></thead><tbody id="student-rows">${rows || '<tr><td colspan="7">No accounts found.</td></tr>'}</tbody></table></div>
    <div class="card" style="margin-top:20px"><h3>Grant or revoke package access</h3><p class="muted">Use this to give a student a package manually (e.g. after verifying an offline payment) or to revoke it. Every change is written to the audit log.</p>
    <form id="entitlement-form" class="inline-form" style="margin-top:12px"><select name="user_id" required><option value="">Select student…</option>${users.filter(u => u.role === 'student').map(u => `<option value="${esc(u.id)}">${esc(u.full_name || u.phone || u.id)}</option>`).join('')}</select><select name="package_id" required><option value="">Select package…</option>${pkgs.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button class="btn btn-primary" type="submit" data-active="true">Grant</button><button class="btn btn-danger" type="submit" data-active="false">Revoke</button></form></div></section>`;
  }

  function adminPackages() {
    const list = A.packages || [];
    return `<section class="admin-panel"><h2>Packages & pricing</h2><p class="muted">Create, edit, publish, unpublish or archive packages. Changes take effect immediately without redeploying the site.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Name</th><th>Price</th><th>Status</th><th>Order</th><th>Actions</th></tr></thead><tbody>${list.map(p => `<tr><td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${money(p.price_pkr)}</td><td><span class="status ${p.status === 'published' ? 'approved' : ''}">${esc(p.status)}</span></td><td>${p.sort_order}</td><td><div class="row-actions"><button class="btn btn-outline" data-edit-package="${esc(p.id)}">Edit</button><button class="btn btn-danger" data-delete-package="${esc(p.id)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="6">No packages yet.</td></tr>'}</tbody></table></div>
    <form id="package-form" class="card" style="margin-top:20px"><h3 id="package-form-title">New package</h3><input type="hidden" name="editing" value="">
      <div class="form-grid"><div class="field"><label>Package ID (slug)</label><input name="id" required placeholder="e.g. verbal" pattern="[a-z0-9-]+"><span class="form-note">Lowercase letters, numbers and dashes. Cannot be changed later.</span></div><div class="field"><label>Name</label><input name="name" required maxlength="120"></div><div class="field"><label>Price (PKR)</label><input name="price_pkr" type="number" min="0" step="1" required></div><div class="field"><label>Display order</label><input name="sort_order" type="number" value="0"></div><div class="field full"><label>Description</label><textarea name="description" maxlength="600"></textarea></div><div class="field full"><label>Features (one per line)</label><textarea name="features" placeholder="Lifetime access&#10;Access after approval"></textarea></div><div class="field"><label>Status</label><select name="status"><option value="published">Published</option><option value="draft">Draft (unpublished)</option><option value="archived">Archived</option></select></div></div>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save package</button><button class="btn btn-outline" type="button" id="package-reset">Clear</button></div></form></section>`;
  }

  function adminPayments() {
    const list = A.payments || [];
    const pending = list.filter(p => p.status === 'pending');
    const rowHtml = p => `<tr><td>${esc(p.package_name_snapshot || p.package_id)}</td><td>${money(p.amount_pkr)}</td><td class="muted">${esc(p.transaction_ref)}</td><td>${p.receipt_path ? `<button class="btn btn-outline" data-receipt="${esc(p.receipt_path)}">View receipt ↗</button>` : '<span class="muted">—</span>'}</td><td><span class="status ${esc(p.status)}">${esc(p.status)}</span></td><td>${fmtDate(p.created_at)}</td><td>${p.status === 'pending' ? `<div class="row-actions"><button class="btn btn-outline" data-payment-action="${esc(p.id)}" data-status="approved">Approve</button><button class="btn btn-danger" data-payment-action="${esc(p.id)}" data-status="rejected">Reject</button></div>` : '—'}</td></tr>`;
    const head = `<tr><th>Package</th><th>Amount</th><th>Transaction ref</th><th>Receipt</th><th>Status</th><th>Submitted</th><th>Actions</th></tr>`;
    return `<section class="admin-panel"><h2>Payment review queue</h2><p class="muted">Open each receipt, then verify the transaction independently in your EasyPaisa records before approving. A screenshot or reference alone is not proof of payment. Approving grants the package entitlement automatically (price and approved-student checks are enforced by the database).</p>
    <h3>Pending (${pending.length})</h3><div class="table-wrap"><table class="data-table"><thead>${head}</thead><tbody>${pending.map(rowHtml).join('') || '<tr><td colspan="7">No pending payments.</td></tr>'}</tbody></table></div>
    <h3 style="margin-top:24px">History</h3><div class="table-wrap"><table class="data-table"><thead>${head}</thead><tbody>${list.filter(p => p.status !== 'pending').map(rowHtml).join('') || '<tr><td colspan="7">No reviewed payments yet.</td></tr>'}</tbody></table></div></section>`;
  }

  function adminResources() {
    const list = A.resources || [], pkgs = A.pkgs || [];
    const pkgOptions = (sel) => pkgs.map(p => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    return `<section class="admin-panel"><h2>Notes & PDF management</h2><p class="muted">Upload a PDF, set its metadata and access rules, then publish. Files go to the private <code>private-notes</code> bucket and are served only through short-lived signed URLs to eligible students.</p>
    <form id="resource-form" class="card"><h3 id="resource-form-title">Add a resource</h3><input type="hidden" name="editing" value="">
      <div class="field"><label>PDF file</label><input type="file" name="file" accept="application/pdf"><span class="form-note">Required for a new resource. Max 50&nbsp;MB, PDF only. Leave empty when editing to keep the current file.</span></div>
      <div id="upload-progress" class="progress hidden"><span></span></div>
      <div class="form-grid" style="margin-top:12px"><div class="field"><label>Title</label><input name="title" required maxlength="160"></div><div class="field"><label>Category</label><input name="category" placeholder="e.g. Verbal" maxlength="80"></div><div class="field"><label>Subject</label><input name="subject" placeholder="e.g. Synonyms" maxlength="80"></div><div class="field"><label>Access</label><select name="access_type"><option value="free">Free (approved students)</option><option value="paid">Paid (package required)</option></select></div><div class="field"><label>Package (for paid)</label><select name="package_id"><option value="">— none —</option>${pkgOptions()}</select></div><div class="field full"><label>Description</label><textarea name="description" maxlength="600"></textarea></div></div>
      <label class="checkline"><input type="checkbox" name="is_preview"> Allow as a free preview</label>
      <label class="checkline"><input type="checkbox" name="published" checked> Published (visible in library)</label>
      <div class="form-actions"><button class="btn btn-primary" type="submit" id="resource-save">Save resource</button><button class="btn btn-outline" type="button" id="resource-reset">Clear</button></div></form>
    <div class="filter-bar" style="margin-top:20px"><input type="search" id="resource-search" placeholder="Search resources…"></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Title</th><th>Category</th><th>Subject</th><th>Access</th><th>Published</th><th>Actions</th></tr></thead><tbody id="resource-rows">${list.map(r => `<tr data-searchrow="${esc(r.title + ' ' + (r.category || '') + ' ' + (r.subject || ''))}"><td>${esc(r.title)}</td><td>${esc(r.category || '—')}</td><td>${esc(r.subject || '—')}</td><td><span class="tag ${r.access_type === 'free' ? 'free' : 'paid'}">${r.access_type}</span></td><td><span class="status ${r.published ? 'approved' : ''}">${r.published ? 'yes' : 'no'}</span></td><td><div class="row-actions"><button class="btn btn-outline" data-edit-resource="${esc(r.id)}">Edit</button><button class="btn btn-secondary" data-toggle-resource="${esc(r.id)}" data-published="${r.published ? 'false' : 'true'}">${r.published ? 'Unpublish' : 'Publish'}</button><button class="btn btn-danger" data-delete-resource="${esc(r.id)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="6">No resources yet. Upload your first PDF above.</td></tr>'}</tbody></table></div></section>`;
  }

  function adminTests() {
    const list = A.tests || [];
    return `<section class="admin-panel"><h2>Practice-test links</h2><p class="muted">Manage external test links. Only HTTPS URLs are accepted. Hiding a link here does not secure the external platform — configure its own permissions separately.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Title</th><th>Category</th><th>URL</th><th>Published</th><th>Actions</th></tr></thead><tbody>${list.map(t => `<tr><td>${esc(t.title)}</td><td>${esc(t.category)}</td><td class="muted">${esc(t.url)}</td><td><span class="status ${t.published ? 'approved' : ''}">${t.published ? 'yes' : 'no'}</span></td><td><div class="row-actions"><button class="btn btn-outline" data-edit-test="${esc(t.id)}">Edit</button><button class="btn btn-danger" data-delete-test="${esc(t.id)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="5">No tests yet.</td></tr>'}</tbody></table></div>
    <form id="test-form" class="card" style="margin-top:20px"><h3 id="test-form-title">Add a test link</h3><input type="hidden" name="editing" value="">
      <div class="form-grid"><div class="field"><label>Title</label><input name="title" required maxlength="160"></div><div class="field"><label>Category</label><select name="category"><option>Verbal</option><option>Non-Verbal</option><option>Academic</option></select></div><div class="field full"><label>HTTPS URL</label><input name="url" type="url" required placeholder="https://…"></div><div class="field full"><label>Description</label><textarea name="description" maxlength="600"></textarea></div></div>
      <label class="checkline"><input type="checkbox" name="published" checked> Published</label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save test link</button><button class="btn btn-outline" type="button" id="test-reset">Clear</button></div></form></section>`;
  }

  function adminAnnouncements() {
    const list = A.announcements || [];
    return `<section class="admin-panel"><h2>Announcements</h2><p class="muted">Create, edit, publish or unpublish academy updates. Unpublishing acts as archiving (hidden from students).</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Title</th><th>Published</th><th>Date</th><th>Actions</th></tr></thead><tbody>${list.map(a => `<tr><td>${esc(a.title)}</td><td><span class="status ${a.published ? 'approved' : ''}">${a.published ? 'yes' : 'no'}</span></td><td>${fmtDate(a.created_at)}</td><td><div class="row-actions"><button class="btn btn-outline" data-edit-ann="${esc(a.id)}">Edit</button><button class="btn btn-danger" data-delete-ann="${esc(a.id)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="4">No announcements yet.</td></tr>'}</tbody></table></div>
    <form id="announcement-form" class="card" style="margin-top:20px"><h3 id="ann-form-title">New announcement</h3><input type="hidden" name="editing" value="">
      <div class="field"><label>Title</label><input name="title" required maxlength="160"></div><div class="field" style="margin-top:10px"><label>Message</label><textarea name="body" required maxlength="5000"></textarea></div>
      <label class="checkline"><input type="checkbox" name="published" checked> Publish immediately</label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save announcement</button><button class="btn btn-outline" type="button" id="ann-reset">Clear</button></div></form></section>`;
  }

  function adminContact() {
    const list = A.messages || [];
    return `<section class="admin-panel"><h2>Contact inbox</h2><p class="muted">Support and payment questions submitted through the contact form. Update the status as you handle them.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Subject</th><th>Message</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map(m => `<tr><td>${esc(m.name)}</td><td class="muted">${esc(m.email)}</td><td>${esc(m.subject)}</td><td class="muted" style="max-width:320px;white-space:pre-wrap">${esc(m.message)}</td><td><span class="status ${m.status === 'new' ? 'pending' : m.status === 'closed' ? 'rejected' : 'approved'}">${esc(m.status)}</span></td><td><div class="row-actions">${m.status !== 'read' ? `<button class="btn btn-outline" data-msg-status="${esc(m.id)}" data-status="read">Mark read</button>` : ''}${m.status !== 'closed' ? `<button class="btn btn-secondary" data-msg-status="${esc(m.id)}" data-status="closed">Close</button>` : ''}<button class="btn btn-danger" data-msg-delete="${esc(m.id)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="6">No messages yet.</td></tr>'}</tbody></table></div></section>`;
  }

  function adminSettings() {
    const c = contactInfo(), pi = (setting('payment_instructions', {}) || {}).text || '', contribs = contributors();
    return `<section class="admin-panel"><h2>Academy settings</h2><p class="muted">These values drive the public Contact page, the About contributors section and the payment instructions shown to students. Saved to the <code>site_settings</code> table.</p>
    <form id="settings-contact" class="card"><h3>Contact details</h3><div class="form-grid"><div class="field"><label>WhatsApp number</label><input name="whatsapp" value="${esc(c.whatsapp)}" maxlength="30"></div><div class="field"><label>EasyPaisa number</label><input name="easypaisa" value="${esc(c.easypaisa)}" maxlength="30"></div><div class="field full"><label>WhatsApp channel URL</label><input name="channel_url" type="url" value="${esc(c.channel_url)}"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Save contact details</button></div></form>
    <form id="settings-payment" class="card" style="margin-top:18px"><h3>Payment instructions</h3><div class="field"><label>Instructions shown when a student requests a package</label><textarea name="text" maxlength="800">${esc(pi)}</textarea></div><div class="form-actions"><button class="btn btn-primary" type="submit">Save instructions</button></div></form>
    <form id="settings-contrib" class="card" style="margin-top:18px"><h3>Material contributors</h3><p class="muted">Credit only. Contributors are not owners or admins. Do not invent photos or credentials.</p>
      ${contribs.map((p, i) => `<div class="form-grid" style="margin-top:10px"><div class="field"><label>Name</label><input name="name_${i}" value="${esc(p.name || '')}" maxlength="80"></div><div class="field"><label>Role</label><input name="role_${i}" value="${esc(p.role || '')}" maxlength="120"></div><div class="field full"><label>Short bio (optional)</label><input name="bio_${i}" value="${esc(p.bio || '')}" maxlength="240"></div></div>`).join('')}
      <input type="hidden" name="count" value="${contribs.length}">
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save contributors</button></div></form>
    <div class="notice info" style="margin-top:18px"><strong>Owner role &amp; admins:</strong> assigning the <code>owner</code> role or promoting an administrator is a privileged database action. Run the owner-promotion SQL from <code>supabase-schema.sql</code>. Ordinary admins cannot promote themselves.</div></section>`;
  }

  function adminSection(tab) {
    if (!db) return `<div class="admin-panel">${configNotice()}</div>`;
    switch (tab) {
      case 'students': return adminStudents();
      case 'packages': return adminPackages();
      case 'payments': return adminPayments();
      case 'resources': return adminResources();
      case 'tests': return adminTests();
      case 'announcements': return adminAnnouncements();
      case 'contact': return adminContact();
      case 'settings': return adminSettings();
      default: return adminOverview();
    }
  }

  async function renderAdmin() {
    if (!isAdmin()) return wrap(`${pageHead('Restricted area', 'Admin access required', 'This dashboard is only available to users whose role has been securely granted in the database.')}${buttonLink('auth', 'Student login')}${!configured ? configNotice() : ''}`);
    await loadAdminData(adminTab);
    return wrap(`<div class="dashboard-top"><div><span class="eyebrow">Restricted administration</span><h1>Academy control centre</h1><p>Manage approvals, payments, notes, packages, tests, announcements, messages and settings.</p></div><span class="status approved">${isOwner() ? 'Owner' : 'Admin'}</span></div>
    <div class="admin-layout"><aside class="admin-side">${adminNav()}</aside><div class="admin-main">${adminSection(adminTab)}</div></div>`);
  }

  // ---------- Router ----------
  const renderers = { home: renderHome, about: renderAbout, packages: renderPackages, notes: () => renderNotes(false), 'free-notes': () => renderNotes(true), tests: renderTests, announcements: renderAnnouncements, contact: renderContact, auth: renderAuth, dashboard: renderDashboard, admin: renderAdmin };

  async function render(page) {
    currentPage = page;
    const app = $('#app');
    app.innerHTML = '<div class="loading-screen"><span class="loader"></span><p>Loading…</p></div>';
    $$('[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    $('#auth-nav').classList.toggle('hidden', !!session);
    $('#dash-nav').classList.toggle('hidden', !session);
    $('#admin-nav').classList.toggle('hidden', !isAdmin());
    try { const fn = renderers[page] || renderHome; app.innerHTML = await withTimeout(fn(), 15000); wirePage(); }
    catch (e) {
      console.error(e);
      const timedOut = e && e.message === '__timeout__';
      const desc = timedOut
        ? 'The request to the database did not finish in time. This most often happens when the site is opened by double-clicking index.html (a file:// address) instead of through the local server, or on a slow connection.'
        : ((e && e.message) ? e.message : 'Please try again.');
      app.innerHTML = wrap(`${pageHead(timedOut ? 'Taking too long' : 'Something went wrong', 'This page could not finish loading', desc)}<div class="form-actions"><button class="btn btn-primary" id="retry-render">Try again</button>${buttonLink('home', 'Back to home', 'btn btn-outline')}</div>${configured ? '' : '<div style="margin-top:20px">' + configNotice() + '</div>'}`);
      const rb = $('#retry-render'); if (rb) rb.addEventListener('click', () => render(page));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#main-nav').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded', 'false');
  }
  function navigate() { const page = (location.hash || '#home').slice(1); render(renderers[page] ? page : 'home'); }
  const reloadAdmin = () => render('admin');

  // ---------- Actions ----------
  async function refreshProfile() { if (!db || !session) { profile = null; return; } const { data, error } = await db.from('profiles').select('*').eq('id', session.user.id).maybeSingle(); if (data) { profile = data; return; } const authErr = error && /auth|jwt|token|session|expired/i.test(error.message || ''); if (!error || authErr) profile = null; /* transient network/refresh error: keep the existing profile so the admin nav does not flicker */ }

  async function downloadResource(id) {
    if (!db || !session || !profile) { toast('Sign in first.'); return; }
    if (!isApproved() && !isAdmin()) { toast(profile.status === 'suspended' ? 'Your account is suspended.' : 'Your account must be approved before downloads are available.'); return; }
    // Server-side authorization: returns the path only if this user is eligible.
    const { data: path, error } = await db.rpc('authorized_resource_path', { resource_id: id });
    if (error || !path) { toast(error && error.message ? error.message : 'You do not have access to this resource.'); return; }
    const { data: link, error: linkError } = await db.storage.from('private-notes').createSignedUrl(path, 60);
    if (linkError || !link?.signedUrl) { toast('Could not create a secure download link.'); return; }
    window.open(link.signedUrl, '_blank', 'noopener,noreferrer');
  }

  function closePurchaseModal() { const m = $('#purchase-modal'); if (m) m.remove(); }

  function openPurchaseModal(pkg) {
    closePurchaseModal();
    const el = document.createElement('div');
    el.id = 'purchase-modal';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(6,12,20,.72);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
    el.innerHTML = `<div class="card" style="max-width:480px;width:100%;max-height:90vh;overflow:auto;margin:0">
      <h3>Request ${esc(pkg.name)}</h3>
      <p class="muted" style="margin:4px 0 12px">Package price: <strong>${money(pkg.price)}</strong></p>
      <div class="notice info" style="margin-bottom:14px">${esc(paymentInstructions())}</div>
      <form id="purchase-form">
        <div class="field"><label for="purchase-tid">EasyPaisa transaction ID (TID)</label>
          <input id="purchase-tid" name="tid" required maxlength="120" placeholder="e.g. 123456789" autocomplete="off">
          <span class="form-note">Never enter your PIN, password or CNIC.</span></div>
        <div class="field" style="margin-top:12px"><label for="purchase-receipt">Payment receipt (screenshot or PDF)</label>
          <input id="purchase-receipt" name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required>
          <span class="form-note">JPG, PNG, WEBP or PDF. Max 8&nbsp;MB. The owner reviews this before access is granted.</span></div>
        <div id="purchase-progress" class="progress hidden"><span></span></div>
        <div class="form-actions" style="margin-top:14px">
          <button class="btn btn-primary" type="submit" id="purchase-submit">Submit for verification</button>
          <button class="btn btn-outline" type="button" id="purchase-cancel">Cancel</button>
        </div>
      </form></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) closePurchaseModal(); });
    $('#purchase-cancel', el).addEventListener('click', closePurchaseModal);
    $('#purchase-form', el).addEventListener('submit', e => { e.preventDefault(); submitPurchase(pkg, el); });
  }

  async function submitPurchase(pkg, modal) {
    const form = $('#purchase-form', modal);
    const f = new FormData(form);
    const tid = String(f.get('tid') || '').trim();
    const fileInput = form.querySelector('input[name="receipt"]');
    const file = fileInput.files && fileInput.files[0];
    const bar = $('#purchase-progress', modal); const btn = $('#purchase-submit', modal);
    if (!tid) { toast('Enter your EasyPaisa transaction ID.'); return; }
    if (!file) { toast('Attach your payment receipt.'); return; }
    const okType = /^image\/(jpeg|png|webp)$/.test(file.type) || file.type === 'application/pdf';
    if (!okType) { toast('Receipt must be a JPG, PNG, WEBP or PDF.'); return; }
    if (file.size > 8388608) { toast('Receipt is larger than the 8 MB limit.'); return; }
    const amount = Number(pkg.price);
    btn.disabled = true; bar.classList.remove('hidden'); bar.classList.add('busy');
    try {
      const ext = file.type === 'application/pdf' ? 'pdf' : (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const receipt_path = `${session.user.id}/${Date.now()}-${slug(pkg.name)}.${ext}`;
      const { error: upErr } = await db.storage.from('payment-receipts').upload(receipt_path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message || 'Receipt upload failed.');
      const { error } = await db.from('payment_requests').insert({
        user_id: session.user.id, package_id: pkg.id, package_name_snapshot: pkg.name,
        transaction_ref: tid.slice(0, 120), amount_pkr: amount,
        receipt_path, receipt_mime: file.type
      });
      if (error) throw new Error(error.message || 'Could not submit payment request.');
      bar.classList.remove('busy'); bar.classList.add('hidden');
      closePurchaseModal();
      toast('Receipt uploaded. Your request is pending owner verification.');
    } catch (err) {
      bar.classList.remove('busy'); bar.classList.add('hidden');
      toast(err.message || 'Could not submit payment request.');
    } finally { btn.disabled = false; }
  }

  async function requestPackage(packageId, packageName) {
    if (!db) { toast('Configure Supabase first.'); return; }
    if (!session) { toast('Please create an account or sign in first.'); location.hash = '#auth'; return; }
    if (!isApproved()) { toast(profile && profile.status === 'suspended' ? 'Your account is suspended.' : 'Verify your email and wait for owner approval before requesting a package.'); location.hash = '#dashboard'; return; }
    const pkg = (packagesCache.length ? packagesCache : packageDefaults).find(p => p.id === packageId);
    if (!pkg) { toast('Package not found.'); return; }
    openPurchaseModal(pkg);
  }

  async function viewReceipt(path) {
    if (!db || !path) { toast('No receipt attached.'); return; }
    const { data: link, error } = await db.storage.from('payment-receipts').createSignedUrl(path, 120);
    if (error || !link?.signedUrl) { toast(error?.message || 'Could not open the receipt.'); return; }
    window.open(link.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function uploadResource(existing) {
    const form = $('#resource-form');
    const f = new FormData(form);
    const title = String(f.get('title') || '').trim();
    const access = String(f.get('access_type'));
    const package_id = String(f.get('package_id') || '').trim() || null;
    if (!title) { toast('Enter a title.'); return; }
    if (access === 'paid' && !package_id) { toast('Paid resources must be linked to a package.'); return; }
    const fileInput = form.querySelector('input[name="file"]');
    const file = fileInput.files && fileInput.files[0];
    const saveBtn = $('#resource-save'); const bar = $('#upload-progress');
    let storage_path = existing ? existing.storage_path : null;
    saveBtn.disabled = true;
    try {
      if (file) {
        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Only PDF files are allowed.');
        if (file.size > 52428800) throw new Error('File is larger than the 50 MB limit.');
        const cat = slug(f.get('category') || 'general');
        storage_path = `${cat}/${slug(title)}-${Date.now()}.pdf`;
        bar.classList.remove('hidden'); bar.classList.add('busy');
        const { error: upErr } = await db.storage.from('private-notes').upload(storage_path, file, { contentType: 'application/pdf', upsert: false });
        bar.classList.remove('busy'); bar.classList.add('hidden');
        if (upErr) throw new Error(upErr.message || 'Upload failed.');
      } else if (!existing) { throw new Error('Choose a PDF file to upload.'); }
      const row = {
        title, description: String(f.get('description') || '').trim(), category: String(f.get('category') || '').trim() || 'General',
        subject: String(f.get('subject') || '').trim(), file_type: 'pdf', access_type: access, package_id,
        is_preview: f.get('is_preview') === 'on', published: f.get('published') === 'on',
      };
      if (file) row.storage_path = storage_path; // new or replacement file
      let id = existing ? existing.id : null, error;
      if (existing) { ({ error } = await db.from('resources').update(row).eq('id', existing.id)); }
      else { row.created_by = session.user.id; const res = await db.from('resources').insert(row).select('id').single(); id = res.data?.id; error = res.error; }
      if (error) throw new Error(error.message || 'Could not save resource.');
      // Sync many-to-many package link (primary package). Keeps package_resources consistent.
      if (id) {
        await db.from('package_resources').delete().eq('resource_id', id);
        if (package_id) await db.from('package_resources').insert({ package_id, resource_id: id, is_preview: row.is_preview });
      }
      toast(existing ? 'Resource updated.' : 'Resource uploaded and saved.');
      A._editingResource = null;
      form.reset(); form.querySelector('input[name="editing"]').value = ''; $('#resource-form-title').textContent = 'Add a resource';
      await reloadAdmin();
    } catch (err) { bar.classList.remove('busy'); bar.classList.add('hidden'); toast(err.message || 'Upload failed.'); }
    finally { saveBtn.disabled = false; }
  }

  // ---------- Wiring ----------
  function wireAuth() {
    let mode = 'login';
    const modeBtns = $$('[data-auth-mode]'); const fields = $('#register-fields'); const submit = $('#auth-submit'); const pass = $('#password');
    const switchMode = m => { mode = m; modeBtns.forEach(b => b.classList.toggle('active', b.dataset.authMode === m)); fields.classList.toggle('hidden', m !== 'register'); $('#full-name').required = m === 'register'; $('#phone').required = m === 'register'; submit.textContent = m === 'register' ? 'Create account →' : 'Login →'; pass.autocomplete = m === 'register' ? 'new-password' : 'current-password'; };
    modeBtns.forEach(b => b.addEventListener('click', () => switchMode(b.dataset.authMode)));
    $('#auth-form')?.addEventListener('submit', async e => {
      e.preventDefault(); if (!db) { toast('Set your Supabase URL and public key in config.js first.'); return; }
      const f = new FormData(e.currentTarget), email = String(f.get('email')).trim(), password = String(f.get('password')); submit.disabled = true;
      try {
        if (mode === 'register') {
          const full_name = String(f.get('full_name') || '').trim(), phone = String(f.get('phone') || '').trim();
          if (!full_name || !phone) throw new Error('Enter your full name and phone number.');
          if (password.length < 8) throw new Error('Password must be at least 8 characters.');
          const { data, error } = await db.auth.signUp({ email, password, options: { data: { full_name, phone }, emailRedirectTo: location.origin + location.pathname + '#dashboard' } });
          if (error) throw error;
          toast(data.session ? 'Account created. Verify your email and wait for approval.' : 'Account created. Check your email to verify the account, then wait for owner approval.');
          if (data.session) { session = data.session; await refreshProfile(); location.hash = '#dashboard'; }
        } else { const { data, error } = await db.auth.signInWithPassword({ email, password }); if (error) throw error; session = data.session; await refreshProfile(); toast('Signed in.'); location.hash = '#dashboard'; }
      } catch (err) { toast(err.message || 'Authentication failed.'); } finally { submit.disabled = false; }
    });
    $('#forgot-password')?.addEventListener('click', async () => { if (!db) { toast('Configure Supabase first.'); return; } const email = $('#email').value.trim(); if (!email) { toast('Enter your email address first.'); return; } const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '#auth' }); toast(error ? error.message : 'If the email exists, a password-reset link will be sent.'); });
  }

  function wireContact() {
    $('#contact-form')?.addEventListener('submit', async e => {
      e.preventDefault(); if (!db) { toast('Configure Supabase before submitting messages.'); return; }
      const f = new FormData(e.currentTarget);
      const { error } = await db.from('contact_messages').insert({ name: String(f.get('name')).trim(), email: String(f.get('email')).trim(), subject: String(f.get('subject')).trim(), message: String(f.get('message')).trim() });
      if (error) { toast(error.message); return; } e.currentTarget.reset(); toast('Message submitted.');
    });
  }

  function wireNotes() {
    const q = $('#notes-q'); if (q) q.addEventListener('input', debounce(e => { notesView.q = e.target.value; notesView.page = 1; softReloadNotes('#notes-q'); }, 300));
    const bindSel = (id, key) => { const el = $(id); if (el) el.addEventListener('change', () => { notesView[key] = el.value; notesView.page = 1; softReloadNotes(); }); };
    bindSel('#notes-category', 'category'); bindSel('#notes-subject', 'subject'); bindSel('#notes-access', 'access');
    $$('button[data-page]').forEach(b => b.addEventListener('click', () => { notesView.page = Number(b.dataset.page); softReloadNotes(); }));
  }
  async function softReloadNotes(refocusSel) { const app = $('#app'); const free = currentPage === 'free-notes'; app.innerHTML = await renderNotes(free); wireNotes(); wireDownloadButtons(); if (refocusSel) { const el = $(refocusSel); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } } }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function wireDownloadButtons() {
    $$('[data-download]').forEach(b => b.addEventListener('click', () => downloadResource(b.dataset.download)));
    $$('[data-restricted]').forEach(b => b.addEventListener('click', () => { if (!session) location.hash = '#auth'; else if (!isApproved()) location.hash = '#dashboard'; else location.hash = '#packages'; }));
  }

  function filterRows(inputSel, bodySel) {
    const input = $(inputSel); if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase();
      $$(bodySel + ' tr[data-searchrow]').forEach(tr => { tr.style.display = tr.dataset.searchrow.toLowerCase().includes(q) ? '' : 'none'; });
    });
  }

  function wireAdmin() {
    if (!isAdmin()) return;
    $$('[data-admin-tab]').forEach(b => b.addEventListener('click', () => { adminTab = b.dataset.adminTab; reloadAdmin(); }));

    // Students
    filterRows('#student-search', '#student-rows');
    $$('[data-user-action]').forEach(b => b.addEventListener('click', async () => {
      const st = b.dataset.status; if (!confirm(`Set this student's status to "${st}"?`)) return;
      const { error } = await db.rpc('admin_set_student_status', { target_user_id: b.dataset.userAction, new_status: st });
      if (error) { toast(error.message); return; } toast('Student status updated.'); await reloadAdmin();
    }));
    $('#entitlement-form')?.addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.submitter; const active = btn && btn.dataset.active === 'true';
      const f = new FormData(e.currentTarget); const uid = String(f.get('user_id') || ''), pid = String(f.get('package_id') || '');
      if (!uid || !pid) { toast('Choose a student and a package.'); return; }
      if (!confirm(`${active ? 'Grant' : 'Revoke'} package "${pid}" for this student?`)) return;
      const { error } = await db.rpc('admin_set_entitlement', { target_user_id: uid, target_package_id: pid, make_active: active });
      if (error) { toast(error.message); return; } toast(active ? 'Access granted.' : 'Access revoked.'); await reloadAdmin();
    });

    // Packages
    const pkgForm = $('#package-form');
    $$('[data-edit-package]').forEach(b => b.addEventListener('click', () => {
      const p = (A.packages || []).find(x => x.id === b.dataset.editPackage); if (!p) return;
      pkgForm.querySelector('[name="editing"]').value = p.id; pkgForm.querySelector('[name="id"]').value = p.id; pkgForm.querySelector('[name="id"]').disabled = true;
      pkgForm.querySelector('[name="name"]').value = p.name || ''; pkgForm.querySelector('[name="price_pkr"]').value = p.price_pkr; pkgForm.querySelector('[name="sort_order"]').value = p.sort_order ?? 0;
      pkgForm.querySelector('[name="description"]').value = p.description || ''; pkgForm.querySelector('[name="features"]').value = (p.features || []).join('\n'); pkgForm.querySelector('[name="status"]').value = p.status || 'published';
      $('#package-form-title').textContent = 'Edit package: ' + p.name; pkgForm.scrollIntoView({ behavior: 'smooth' });
    }));
    $('#package-reset')?.addEventListener('click', () => { pkgForm.reset(); pkgForm.querySelector('[name="editing"]').value = ''; pkgForm.querySelector('[name="id"]').disabled = false; $('#package-form-title').textContent = 'New package'; });
    pkgForm?.addEventListener('submit', async e => {
      e.preventDefault(); const f = new FormData(pkgForm); const editing = String(f.get('editing') || '');
      const row = { name: String(f.get('name')).trim(), description: String(f.get('description') || '').trim(), price_pkr: Number(f.get('price_pkr') || 0), sort_order: Number(f.get('sort_order') || 0), status: String(f.get('status')), features: String(f.get('features') || '').split('\n').map(s => s.trim()).filter(Boolean) };
      let error;
      if (editing) { ({ error } = await db.from('packages').update(row).eq('id', editing)); }
      else { row.id = String(f.get('id')).trim().toLowerCase(); if (!/^[a-z0-9-]+$/.test(row.id)) { toast('Package ID must be lowercase letters, numbers and dashes.'); return; } ({ error } = await db.from('packages').insert(row)); }
      if (error) { toast(error.message); return; } toast('Package saved.'); await reloadAdmin();
    });
    $$('[data-delete-package]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this package? Existing entitlements and payment records referencing it may be affected.')) return;
      const { error } = await db.from('packages').delete().eq('id', b.dataset.deletePackage); if (error) { toast(error.message); return; } toast('Package deleted.'); await reloadAdmin();
    }));

    // Payments
    $$('[data-payment-action]').forEach(b => b.addEventListener('click', async () => {
      const st = b.dataset.status; if (!confirm(`Mark this payment "${st}"? Confirm the transaction in EasyPaisa records first.`)) return;
      const { error } = await db.rpc('admin_review_payment', { target_payment_id: b.dataset.paymentAction, new_status: st });
      if (error) { toast(error.message); return; } toast('Payment reviewed.'); await reloadAdmin();
    }));
    $$('[data-receipt]').forEach(b => b.addEventListener('click', () => viewReceipt(b.dataset.receipt)));

    // Resources
    filterRows('#resource-search', '#resource-rows');
    $('#resource-form')?.addEventListener('submit', e => { e.preventDefault(); uploadResource(A._editingResource || null); });
    $('#resource-reset')?.addEventListener('click', () => { $('#resource-form').reset(); $('#resource-form').querySelector('[name="editing"]').value = ''; A._editingResource = null; $('#resource-form-title').textContent = 'Add a resource'; });
    $$('[data-edit-resource]').forEach(b => b.addEventListener('click', () => {
      const r = (A.resources || []).find(x => x.id === b.dataset.editResource); if (!r) return; A._editingResource = r;
      const form = $('#resource-form'); form.querySelector('[name="editing"]').value = r.id; form.querySelector('[name="title"]').value = r.title || '';
      form.querySelector('[name="category"]').value = r.category || ''; form.querySelector('[name="subject"]').value = r.subject || '';
      form.querySelector('[name="description"]').value = r.description || ''; form.querySelector('[name="access_type"]').value = r.access_type || 'free';
      form.querySelector('[name="package_id"]').value = r.package_id || ''; form.querySelector('[name="is_preview"]').checked = !!r.is_preview; form.querySelector('[name="published"]').checked = !!r.published;
      $('#resource-form-title').textContent = 'Edit resource: ' + r.title; form.scrollIntoView({ behavior: 'smooth' });
    }));
    $$('[data-toggle-resource]').forEach(b => b.addEventListener('click', async () => {
      const pub = b.dataset.published === 'true'; const { error } = await db.from('resources').update({ published: pub }).eq('id', b.dataset.toggleResource);
      if (error) { toast(error.message); return; } toast(pub ? 'Resource published.' : 'Resource unpublished.'); await reloadAdmin();
    }));
    $$('[data-delete-resource]').forEach(b => b.addEventListener('click', async () => {
      const r = (A.resources || []).find(x => x.id === b.dataset.deleteResource); if (!confirm('Delete this resource? The stored PDF file will remain in the bucket unless you remove it in Supabase Storage.')) return;
      const { error } = await db.from('resources').delete().eq('id', b.dataset.deleteResource); if (error) { toast(error.message); return; }
      if (r && r.storage_path) { try { await db.storage.from('private-notes').remove([r.storage_path]); } catch {} }
      toast('Resource deleted.'); await reloadAdmin();
    }));

    // Tests
    const testForm = $('#test-form');
    $$('[data-edit-test]').forEach(b => b.addEventListener('click', () => {
      const t = (A.tests || []).find(x => x.id === b.dataset.editTest); if (!t) return;
      testForm.querySelector('[name="editing"]').value = t.id; testForm.querySelector('[name="title"]').value = t.title || ''; testForm.querySelector('[name="category"]').value = t.category || 'Verbal';
      testForm.querySelector('[name="url"]').value = t.url || ''; testForm.querySelector('[name="description"]').value = t.description || ''; testForm.querySelector('[name="published"]').checked = !!t.published;
      $('#test-form-title').textContent = 'Edit test link'; testForm.scrollIntoView({ behavior: 'smooth' });
    }));
    $('#test-reset')?.addEventListener('click', () => { testForm.reset(); testForm.querySelector('[name="editing"]').value = ''; $('#test-form-title').textContent = 'Add a test link'; });
    testForm?.addEventListener('submit', async e => {
      e.preventDefault(); const f = new FormData(testForm); const url = String(f.get('url')).trim(); const editing = String(f.get('editing') || '');
      if (!/^https:\/\/.+/i.test(url)) { toast('Use a valid HTTPS URL.'); return; }
      const row = { title: String(f.get('title')).trim(), category: String(f.get('category')), url, description: String(f.get('description') || '').trim(), published: f.get('published') === 'on' };
      let error; if (editing) { ({ error } = await db.from('practice_tests').update(row).eq('id', editing)); } else { row.created_by = session.user.id; ({ error } = await db.from('practice_tests').insert(row)); }
      if (error) { toast(error.message); return; } toast('Test link saved.'); await reloadAdmin();
    });
    $$('[data-delete-test]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this test link?')) return; const { error } = await db.from('practice_tests').delete().eq('id', b.dataset.deleteTest); if (error) { toast(error.message); return; } toast('Test deleted.'); await reloadAdmin(); }));

    // Announcements
    const annForm = $('#announcement-form');
    $$('[data-edit-ann]').forEach(b => b.addEventListener('click', () => {
      const a = (A.announcements || []).find(x => x.id === b.dataset.editAnn); if (!a) return;
      annForm.querySelector('[name="editing"]').value = a.id; annForm.querySelector('[name="title"]').value = a.title || ''; annForm.querySelector('[name="body"]').value = a.body || ''; annForm.querySelector('[name="published"]').checked = !!a.published;
      $('#ann-form-title').textContent = 'Edit announcement'; annForm.scrollIntoView({ behavior: 'smooth' });
    }));
    $('#ann-reset')?.addEventListener('click', () => { annForm.reset(); annForm.querySelector('[name="editing"]').value = ''; $('#ann-form-title').textContent = 'New announcement'; });
    annForm?.addEventListener('submit', async e => {
      e.preventDefault(); const f = new FormData(annForm); const editing = String(f.get('editing') || '');
      const row = { title: String(f.get('title')).trim(), body: String(f.get('body')).trim(), published: f.get('published') === 'on' };
      let error; if (editing) { ({ error } = await db.from('announcements').update(row).eq('id', editing)); } else { row.created_by = session.user.id; ({ error } = await db.from('announcements').insert(row)); }
      if (error) { toast(error.message); return; } toast('Announcement saved.'); await reloadAdmin();
    });
    $$('[data-delete-ann]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this announcement?')) return; const { error } = await db.from('announcements').delete().eq('id', b.dataset.deleteAnn); if (error) { toast(error.message); return; } toast('Announcement deleted.'); await reloadAdmin(); }));

    // Contact inbox
    $$('[data-msg-status]').forEach(b => b.addEventListener('click', async () => { const { error } = await db.from('contact_messages').update({ status: b.dataset.status }).eq('id', b.dataset.msgStatus); if (error) { toast(error.message); return; } toast('Message updated.'); await reloadAdmin(); }));
    $$('[data-msg-delete]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this message permanently?')) return; const { error } = await db.from('contact_messages').delete().eq('id', b.dataset.msgDelete); if (error) { toast(error.message); return; } toast('Message deleted.'); await reloadAdmin(); }));

    // Settings
    $('#settings-contact')?.addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.currentTarget); await saveSetting('contact', { whatsapp: String(f.get('whatsapp')).trim(), easypaisa: String(f.get('easypaisa')).trim(), channel_url: String(f.get('channel_url')).trim() }); });
    $('#settings-payment')?.addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.currentTarget); await saveSetting('payment_instructions', { text: String(f.get('text')).trim() }); });
    $('#settings-contrib')?.addEventListener('submit', async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const n = Number(f.get('count') || 0); const arr = [];
      for (let i = 0; i < n; i++) { const name = String(f.get('name_' + i) || '').trim(); if (name) arr.push({ name, role: String(f.get('role_' + i) || '').trim(), bio: String(f.get('bio_' + i) || '').trim() }); }
      await saveSetting('contributors', arr);
    });
  }

  async function saveSetting(key, value) {
    if (!db) { toast('Configure Supabase first.'); return; }
    const { error } = await db.from('site_settings').upsert({ key, value, updated_by: session.user.id, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { toast(error.message); return; }
    await loadSettings(); toast('Settings saved.'); await reloadAdmin();
  }

  function wirePage() {
    wireAuth(); wireContact(); wireNotes(); wireAdmin(); wireDownloadButtons();
    $$('[data-buy]').forEach(b => b.addEventListener('click', () => requestPackage(b.dataset.buy, b.dataset.name)));
    $('#logout-btn')?.addEventListener('click', async () => { if (db) await db.auth.signOut(); session = null; profile = null; toast('Signed out.'); location.hash = '#home'; });
    $('#retry-render')?.addEventListener('click', () => navigate());
    $('#reset-password-btn')?.addEventListener('click', async () => { if (!db || !session) return; const { error } = await db.auth.resetPasswordForEmail(session.user.email, { redirectTo: location.origin + location.pathname + '#auth' }); toast(error ? error.message : 'Password-reset email sent.'); });
  }

  // ---------- Boot ----------
  $('#menu-toggle').addEventListener('click', () => { const nav = $('#main-nav'); nav.classList.toggle('open'); $('#menu-toggle').setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false'); });
  $('#year').textContent = new Date().getFullYear();
  window.addEventListener('hashchange', navigate);

  function syncAuthNav() {
    const a = $('#auth-nav'), d = $('#dash-nav'), m = $('#admin-nav');
    if (a) a.classList.toggle('hidden', !!session);
    if (d) d.classList.toggle('hidden', !session);
    if (m) m.classList.toggle('hidden', !isAdmin());
  }

  async function init() {
    if (db) {
      // Time-boxed so a stalled auth/network call can never freeze the app on the splash screen.
      try { const { data } = await withTimeout(db.auth.getSession(), 8000); session = (data && data.session) || null; }
      catch (e) { console.warn('Session check timed out.', e); session = null; }
      // Keep an authorized user logged in across tab closes / restarts. If the stored access
      // token has expired, try to REFRESH it with the refresh token before giving up. Only sign
      // out when the refresh definitively fails (truly dead session) — otherwise the user would
      // be forced to log in again every time the 1-hour access token lapses.
      if (session && session.expires_at && (session.expires_at * 1000) < Date.now()) {
        try {
          const { data, error } = await withTimeout(db.auth.refreshSession(), 8000);
          if (!error && data && data.session) { session = data.session; }
          else { try { await withTimeout(db.auth.signOut(), 6000); } catch (_) { /* ignore */ } session = null; profile = null; }
        } catch (_) { /* transient network error: keep the session and let auto-refresh recover */ }
      }
      if (session) { try { await withTimeout(refreshProfile(), 8000); } catch (e) { console.warn('Profile load timed out.', e); profile = null; } }
      // Never await database calls inside onAuthStateChange: supabase-js emits this event while
      // holding its internal auth lock, so an awaited query here deadlocks and freezes startup.
      // Defer the work to a new task (setTimeout 0) that runs after the lock is released.
      db.auth.onAuthStateChange((event, newSession) => {
        session = newSession;
        // Token refreshes and the initial session don't change WHO is logged in, and init()
        // already loaded the profile. Re-rendering on these is what made the Admin link flicker.
        if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') { syncAuthNav(); return; }
        setTimeout(async () => {
          if (event === 'SIGNED_OUT') profile = null;
          else { try { await refreshProfile(); } catch (_) { /* keep existing profile */ } }
          syncAuthNav();
          if (['dashboard', 'admin'].includes((location.hash || '').slice(1))) navigate();
        }, 0);
      });
      syncAuthNav();
      // Load catalogs without letting a stall hang first paint.
      try { await withTimeout(Promise.allSettled([loadSettings(), loadPackages(), loadNotes(), loadPackageResources(), loadTests(), loadAnnouncements()]), 12000); }
      catch (e) { console.warn('Catalog load timed out.', e); }
    }
    navigate();
  }
  init();
})();
