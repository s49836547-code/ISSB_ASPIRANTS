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
  let openThreadId = null;
  let notesCache = [], packagesCache = [], testsCache = [], announcementsCache = [], prCache = [], settings = {};
  let guidesCache = [], reviewsCache = [], experiencesCache = [];
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
  const contactInfo = () => setting('contact', { whatsapp: '03472433655', easypaisa: '03472433655', channel_url: 'https://whatsapp.com/channel/0029VbBqGMj8qIzjSRWwHr1V' });
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
  // One-click reminder to a student who has not finished the signup steps.
  // Message is chosen from what is actually missing (email verification / approval).
  function studentReminderLink(u, emailRow) {
    const n = waNumber(u && u.phone);
    if (!n) return '';
    const name = (u && u.full_name) ? u.full_name.trim().split(/\s+/)[0] : 'student';
    const site = location.origin + location.pathname;
    const verified = emailRow ? emailRow.email_verified : true;
    let msg;
    if (!verified) {
      msg = `Assalam-o-Alaikum ${name}! ISSB ASPIRANTS par aap ka account ban gaya hai, lekin aap ki email abhi verify nahi hui. Kindly apna email inbox (aur spam folder) check karein aur verification link par click karein. Phir owner aap ko approve kar dega.\n\nSite: ${site}`;
    } else if (u.status === 'approved') {
      msg = `Assalam-o-Alaikum ${name}! Aap ka ISSB ASPIRANTS account APPROVE kar diya gaya hai. Ab aap login kar ke notes dekh aur download kar sakte hain.\n\nSite: ${site}`;
    } else if (u.status === 'suspended') {
      msg = `Assalam-o-Alaikum ${name}! Aap ka ISSB ASPIRANTS account filhaal suspended hai. Barah-e-karam academy se rabta karein.\n\nSite: ${site}`;
    } else if (u.status === 'rejected') {
      msg = `Assalam-o-Alaikum ${name}! Aap ki ISSB ASPIRANTS application approve nahi hui. Mazeed maloomat ke liye academy se rabta karein.\n\nSite: ${site}`;
    } else {
      msg = `Assalam-o-Alaikum ${name}! Aap ki ISSB ASPIRANTS application owner approval ke liye pending hai. Jald hi aap ko access mil jaye ga.\n\nSite: ${site}`;
    }
    return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
  }
  const contributors = () => setting('contributors', [
    { name: 'Meer', role: 'Study material contributor & WhatsApp channel operator', bio: '' },
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
  async function loadGuides() { if (!db) return; const { data, error } = await db.from('guides').select('*').eq('published', true).order('sort_order').order('created_at', { ascending: false }); if (!error) guidesCache = data || []; }
  async function loadReviews() { if (!db) return; const { data, error } = await db.from('reviews').select('id,name,rating,body,context,status,admin_reply,created_at').eq('status', 'published').order('created_at', { ascending: false }); if (!error) reviewsCache = data || []; }
  async function loadExperiences() { if (!db) return; const { data, error } = await db.from('experiences').select('id,name,result,body,helped_with,admin_reply,created_at').eq('status', 'published').order('created_at', { ascending: false }); if (!error) experiencesCache = data || []; }

  // ---------- Media helpers ----------
  // Interview attire has two fixed galleries; everything else is general guidance.
  const GUIDE_CATS = {
    'formal-suit': 'Formal suit',
    'shalwar-kameez': 'Shalwar kameez',
    'video-guidance': 'Video guidance',
    'interview-tips': 'Interview tips',
    'information': 'Information',
    'call': 'Interview call',
    // legacy keys, so any older row still gets a readable label
    interview: 'Interview tips', tips: 'Preparation tips', other: 'Guidance'
  };
  const ATTIRE_CATS = ['formal-suit', 'shalwar-kameez'];
  const guideCat = c => GUIDE_CATS[c] || c || 'Guidance';
  const isAttireCat = c => ATTIRE_CATS.indexOf(c) >= 0;
  // Accepts a YouTube/Vimeo watch link, an embed link, a direct video file,
  // or a same-origin relative path to a video shipped with the site.
  function videoEmbed(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    const relative = /^(?:\.?\/)?[\w-]+(?:\/[\w.-]+)*\.(?:mp4|webm|ogg|mov)$/i.test(u);
    if (!relative && !/^https:\/\//i.test(u)) return '';
    let id = '';
    const y = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
    if (y) id = y[1];
    if (id) return `<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}" title="Guidance video" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    const v = u.match(/vimeo\.com\/(\d+)/);
    if (v) return `<div class="video-wrap"><iframe src="https://player.vimeo.com/video/${esc(v[1])}" title="Guidance video" loading="lazy" allow="fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    if (/\.(mp4|webm|ogg|mov)$/i.test(u)) return `<div class="video-wrap"><video controls preload="metadata" playsinline onloadedmetadata="if(this.videoHeight>this.videoWidth)this.parentNode.classList.add('portrait')" src="${esc(u)}"></video></div>`;
    return '';
  }
  const stars = n => { const r = Math.max(0, Math.min(5, Number(n) || 0)); return `<span class="stars" aria-label="${r} out of 5">${'★'.repeat(r)}${'☆'.repeat(5 - r)}</span>`; };
  // A guide can hold a whole gallery of pictures; image_url is kept as the cover.
  const guideImages = g => [...new Set([...(g.image_urls || []), g.image_url].map(s => String(s || '').trim()).filter(Boolean))];
  // Starter attire guides ship with the site so students get correct guidance even
  // before the academy has uploaded anything. Hidden once a real guide exists for
  // the same category.
  const BUILTIN_GUIDES = [
    {
      id: 'builtin-formal-suit', builtin: true, category: 'formal-suit', sort_order: 0,
      title: 'Formal suit — what to wear to the ISSB interview',
      summary: 'Charcoal-navy three-piece suit, plain white shirt, solid maroon tie and polished black oxfords. Quiet, fitted and formal beats expensive and flashy.',
      points: [
        'Suit: charcoal or navy three-piece, slim fit, no loose fabric and no shine',
        'Shirt: plain white, spread collar, well ironed, cuffs showing 1 cm past the jacket',
        'Tie: solid maroon, navy or burgundy silk — no cartoon patterns, no bright novelty colours',
        'Waistcoat: same cloth as the suit, buttoned except the bottom button',
        'Shoes: black leather oxfords, polished, with dark grey or navy socks',
        'Belt: black leather with a small plain buckle, matching the shoes',
        'Grooming: short hair, clean shave, trimmed nails, no strong perfume',
        'Extras: a simple metal or leather-strap watch, and carry your CNIC plus call letter in a folder'
      ],
      image_urls: ['guidance/formal-suit-attire.png'], image_url: 'guidance/formal-suit-attire.png', video_url: ''
    },
    {
      id: 'builtin-shalwar-kameez', builtin: true, category: 'shalwar-kameez', sort_order: 0,
      title: 'Shalwar kameez with waistcoat — national dress for the interview',
      summary: 'Plain off-white or cream shalwar kameez with a fitted navy waistcoat, black formal shoes and neat grooming. Traditional dress is fully acceptable at the ISSB interview.',
      points: [
        'Kameez: plain, well ironed, small neat collar, sleeves to the wrist, no embroidery',
        'Colours that work: off-white, light cream, sky blue, light grey',
        'Waistcoat: navy, charcoal or dark green — plain, fitted, buttoned up',
        'Shalwar: matching colour, neatly stitched, not baggy, hem just above the shoe',
        'Shoes: black leather formal shoes, polished, worn with plain dark socks',
        'Avoid: bright colours, prints, heavy embroidery, jeans or sneakers',
        'Grooming: short hair, clean shave, trimmed nails',
        'Both options are equally acceptable — wear whichever you can carry confidently and comfortably'
      ],
      image_urls: ['guidance/shalwar-kameez-attire.png'], image_url: 'guidance/shalwar-kameez-attire.png', video_url: ''
    },
    {
      id: 'builtin-selection-explainer', builtin: true, category: 'video-guidance', sort_order: -1,
      title: 'ISSB selection explained — initial test to recommendation',
      summary: 'A 40-second walkthrough of the whole journey: initial test, physical, medical, the five ISSB days, interview dress and the board result.',
      points: [
        'Stage 1 initial test: verbal, non-verbal and academic — the biggest filter',
        'Stage 2 physical: 1.6 km run, push-ups, sit-ups, chin-ups and the ditch jump',
        'Stage 3 medical: height, weight, eyesight and general fitness',
        'ISSB days 1-5: check-in, psychologist tests, GTO tasks, interview and board conference',
        'Interview dress: formal suit or plain shalwar kameez — both are acceptable'
      ],
      image_urls: [], image_url: '', video_url: 'guidance/issb-selection-explainer.mp4'
    },
    {
      id: 'builtin-interview-answers', builtin: true, category: 'interview-tips', sort_order: -1,
      title: 'How to answer ISSB interview questions — in your own voice',
      summary: 'Full interview guidance: build every answer from your own life, use the listen-pause-answer method, handle the usual questions, and stay natural instead of copying someone else\'s style.',
      points: [
        'Every answer grows from your real story: family, studies, hobbies, strengths and weaknesses',
        'Never copy a style — cross-questions collapse a borrowed answer on the second question',
        'Listen to the full question, pause a second, then two or three honest sentences with one real example',
        "If you don't know, say so plainly and offer what you do know — honesty reads as confidence",
        'Sit tall, gentle eye contact, calm voice: nervous is fine, fake is not',
        'Practice out loud without a script, then re-say each answer in different words to build ownership'
      ],
      image_urls: [], image_url: '', video_url: 'guidance/issb-interview-answers.mp4'
    }
  ];
  const mediaUrl = path => (path && db) ? db.storage.from('guidance-media').getPublicUrl(path).data.publicUrl : '';
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

  // ---------- Announcement ticker (visible on every page) ----------
  let tickerIdx = 0, tickerTimer = null, tickerHidden = false;
  function updateTicker() {
    const el = $('#ticker');
    if (!el) return;
    const list = (announcementsCache || []).filter(a => a && (a.title || a.body));
    if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
    if (tickerHidden || !list.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (tickerIdx >= list.length) tickerIdx = 0;
    const link = $('#ticker-link', el), dots = $('#ticker-dots', el);
    const show = () => {
      const a = list[tickerIdx];
      const body = String(a.body || '').replace(/\s+/g, ' ').trim();
      link.textContent = body ? `${a.title} — ${body.length > 150 ? body.slice(0, 150) + '…' : body}` : a.title;
      link.classList.remove('slide-in'); void link.offsetWidth; link.classList.add('slide-in');
      if (dots) {
        dots.innerHTML = list.length > 1 ? list.map((_, i) => `<button type="button" class="dot ${i === tickerIdx ? 'on' : ''}" data-ticker="${i}" aria-label="Announcement ${i + 1}"></button>`).join('') : '';
        $$('[data-ticker]', dots).forEach(d => d.addEventListener('click', () => { tickerIdx = Number(d.dataset.ticker); show(); restart(); }));
      }
    };
    const restart = () => { if (tickerTimer) clearInterval(tickerTimer); if (list.length > 1) tickerTimer = setInterval(() => { tickerIdx = (tickerIdx + 1) % list.length; show(); }, 5200); };
    show(); restart();
    const close = $('#ticker-close', el);
    if (close) close.onclick = () => { tickerHidden = true; updateTicker(); };
  }

  // ---------- Public pages ----------
  async function renderHome() {
    const c = contactInfo();
    await loadExperiences();
    const exps = (experiencesCache || []).slice(0, 3);
    const expStrip = exps.length ? `<section class="section band"><div class="container"><div class="section-head"><span class="kicker">Before you join</span><h2>Students who prepared here, in their own words.</h2><p>Real outcomes from students who used ISSB ASPIRANTS material — each story is published after academy review.</p></div><div class="grid grid-3">${exps.map(x => `<article class="card exp-card"><span class="${expChip(x.result)}">${esc(x.result)}</span><h3>${esc(x.name)}</h3><p>${esc(x.body.slice(0, 220))}${x.body.length > 220 ? '…' : ''}</p></article>`).join('')}</div><div class="form-actions">${buttonLink('experiences', 'Read all experiences')}</div></div></section>` : '';
    return `<section class="hero"><div class="hero-inner"><span class="eyebrow">✦ Structured preparation · Independent resources</span><h1>Prepare with purpose.<br><span>Perform with confidence.</span></h1><p>Explore ISSB preparation notes, intelligence practice resources, academic material and curated mock tests — organised to help you prepare with consistency.</p><div class="actions">${buttonLink('auth', 'Create Student Account')}${buttonLink('packages', 'Explore Packages', 'btn btn-secondary')}</div><div class="stat-row"><div class="stat"><strong>01</strong><span>Register and verify your email</span></div><div class="stat"><strong>02</strong><span>Wait for account approval</span></div><div class="stat"><strong>03</strong><span>Access eligible resources</span></div></div></div></section>
    ${expStrip}
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
    updateTicker();
    return wrap(`${pageHead('Updates', 'Announcements', 'Updates published by the ISSB ASPIRANTS team. The newest one also runs in the ticker at the top of every page.')}
    <div class="grid">${announcementsCache.length ? announcementsCache.map(a => `<article class="card"><span class="kicker">${fmtDate(a.created_at)}</span><h3>${esc(a.title)}</h3><p style="white-space:pre-wrap"><strong>${esc(a.body)}</strong></p></article>`).join('') : empty('No announcements yet', 'New updates will appear here when published.', '◷')}</div>`);
  }

  // ---------- Guidance centre: two attire galleries + video/tips guidance ----------
  const guidesView = { cat: '' };
  let lbState = { list: [], idx: 0, img: 0 };

  function allGuides() {
    const real = guidesCache || [];
    const usedCats = new Set(real.map(g => g.category));
    // Only the attire galleries get superseded by an owner upload; the explainer
    // video should stay visible alongside any guidance the owner adds.
    return [...BUILTIN_GUIDES.filter(b => !isAttireCat(b.category) || !usedCats.has(b.category)), ...real];
  }
  const visibleGuides = () => allGuides().filter(g => !guidesView.cat || g.category === guidesView.cat);

  function galleryGrid(list) {
    return `<div class="gallery-grid">${list.map(g => {
      const imgs = guideImages(g);
      return `<button type="button" class="gallery-item" data-guide-open="${esc(g.id)}">
        ${imgs[0] ? `<img src="${esc(imgs[0])}" alt="${esc(g.title)}" loading="lazy" onerror="this.style.display='none'">` : '<span class="gallery-noimg">✦</span>'}
        <span class="gallery-cap"><strong>${esc(g.title)}</strong><small>${imgs.length > 1 ? imgs.length + ' pictures · ' : ''}tap to open</small></span>
      </button>`;
    }).join('')}</div>`;
  }

  function guideCard(g) {
    const pts = (g.points || []).filter(p => String(p || '').trim());
    const imgs = guideImages(g);
    const vid = videoEmbed(g.video_url);
    return `<article class="card guide-card">${imgs[0] ? `<div class="guide-media"><img src="${esc(imgs[0])}" alt="${esc(g.title)}" loading="lazy" onerror="this.parentNode.style.display='none'"></div>` : ''}
    <div class="resource-meta"><span class="tag">${esc(guideCat(g.category))}</span>${g.created_at ? `<span class="tag">${fmtDate(g.created_at)}</span>` : ''}</div>
    <h3>${esc(g.title)}</h3>
    ${g.summary ? `<p><strong>${esc(g.summary)}</strong></p>` : ''}
    ${pts.length ? `<ul class="points">${pts.map(p => `<li><strong>${esc(p)}</strong></li>`).join('')}</ul>` : ''}
    ${vid || (String(g.video_url || '').trim() ? `<p class="form-note"><a href="${esc(g.video_url)}" target="_blank" rel="noopener noreferrer">Watch the video ↗</a></p>` : '')}
    ${imgs.length > 1 ? `<div class="form-actions" style="padding:0 20px"><button type="button" class="btn btn-outline" data-guide-open="${esc(g.id)}">Open gallery (${imgs.length}) →</button></div>` : ''}
    </article>`;
  }

  function attireSection(c) {
    const list = allGuides().filter(g => g.category === c);
    const blurb = c === 'formal-suit'
      ? 'Formal suit, shirt, tie, waistcoat and shoes — the colours and fit that hold up in front of the board.'
      : 'Plain shalwar kameez with a fitted waistcoat — the national-dress option, equally acceptable at the interview.';
    return `<section style="padding:0 0 34px"><div class="section-head"><span class="kicker">Interview attire</span><h2>${esc(guideCat(c))} gallery</h2><p>${blurb}</p></div>
    ${list.length ? galleryGrid(list) : empty('Nothing in this gallery yet', 'The academy has not uploaded pictures to this gallery yet.', '🖼')}</section>`;
  }

  async function renderGuidance() {
    await loadGuides();
    const all = allGuides();
    const present = [...new Set(all.map(g => g.category).filter(Boolean))];
    const tabs = ['', ...ATTIRE_CATS.filter(c => present.indexOf(c) >= 0), ...present.filter(c => !isAttireCat(c))];
    const chips = `<div class="filter-bar">${tabs.map(c => `<button class="btn ${guidesView.cat === c ? 'btn-primary' : 'btn-outline'}" data-guide-cat="${esc(c)}">${c ? esc(guideCat(c)) + (isAttireCat(c) ? ' gallery' : '') : 'All guidance'}</button>`).join('')}</div>`;

    let body;
    if (guidesView.cat && isAttireCat(guidesView.cat)) {
      const list = all.filter(g => g.category === guidesView.cat);
      body = list.length ? galleryGrid(list) : empty('Nothing in this gallery yet', 'The academy has not uploaded pictures to this gallery yet.', '🖼');
    } else if (guidesView.cat) {
      const list = all.filter(g => g.category === guidesView.cat);
      body = `<div class="grid grid-3">${list.map(guideCard).join('') || empty('Nothing published here yet', 'Video guidance, tips and calls will appear here as soon as the academy publishes them.', '▶')}</div>`;
    } else {
      const rest = all.filter(g => !isAttireCat(g.category));
      body = `${attireSection('formal-suit')}${attireSection('shalwar-kameez')}
      <section style="padding:0"><div class="section-head"><span class="kicker">Preparation help</span><h2>Video guidance, tips &amp; calls</h2><p>Video guidance on preparation, interview tips, useful information and interview call announcements — all published from the admin portal.</p></div>
      <div class="grid grid-3">${rest.map(guideCard).join('') || empty('Nothing published here yet', 'Video guidance, interview tips and calls will appear here as soon as the academy publishes them.', '▶')}</div></section>`;
    }
    return wrap(`${pageHead('Guidance centre', 'Interview attire galleries & video guidance', 'Two separate galleries — formal suit and shalwar kameez — plus video guidance, interview tips and interview calls. Every entry is published by the academy from the admin portal.')}
    ${chips}${body}`);
  }

  // Lightbox viewer for a gallery entry (lives outside #app so re-renders do not kill it).
  function closeLightbox() { const el = $('#guide-lightbox'); if (el) el.remove(); document.removeEventListener('keydown', lightboxKeys); }
  function lightboxKeys(e) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') stepLightbox(1);
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
  }
  function stepLightbox(d) {
    const n = lbState.list.length;
    if (!n) return;
    lbState.idx = (lbState.idx + d + n) % n;
    lbState.img = 0;
    drawLightbox();
  }
  function drawLightbox() {
    const host = $('#guide-lightbox');
    if (!host) return;
    const g = lbState.list[lbState.idx];
    if (!g) { closeLightbox(); return; }
    const imgs = guideImages(g);
    const pts = (g.points || []).filter(p => String(p || '').trim());
    host.innerHTML = `<div class="lb-card" role="dialog" aria-modal="true" aria-label="${esc(g.title)}">
      <button type="button" class="lb-close" data-lb-close aria-label="Close">&times;</button>
      <div class="lb-stage">${imgs.length ? `<img src="${esc(imgs[Math.min(lbState.img, imgs.length - 1)])}" alt="${esc(g.title)}">` : '<span class="gallery-noimg">✦</span>'}</div>
      ${imgs.length > 1 ? `<div class="lb-strip">${imgs.map((u, i) => `<button type="button" class="${i === lbState.img ? 'on' : ''}" data-lb-img="${i}"><img src="${esc(u)}" alt="Picture ${i + 1}" loading="lazy"></button>`).join('')}</div>` : ''}
      <div class="lb-body">
        <span class="tag">${esc(guideCat(g.category))}</span>
        <h3>${esc(g.title)}</h3>
        ${g.summary ? `<p><strong>${esc(g.summary)}</strong></p>` : ''}
        ${pts.length ? `<ul class="points">${pts.map(p => `<li><strong>${esc(p)}</strong></li>`).join('')}</ul>` : ''}
        ${videoEmbed(g.video_url) || ''}
        ${lbState.list.length > 1 ? `<div class="form-actions"><button type="button" class="btn btn-outline" data-lb-prev>← Previous</button><span class="muted">${lbState.idx + 1} of ${lbState.list.length}</span><button type="button" class="btn btn-outline" data-lb-next>Next →</button></div>` : ''}
      </div></div>`;
    $('[data-lb-close]', host).onclick = closeLightbox;
    $$('[data-lb-img]', host).forEach(b => b.onclick = () => { lbState.img = Number(b.dataset.lbImg); drawLightbox(); });
    const prev = $('[data-lb-prev]', host), next = $('[data-lb-next]', host);
    if (prev) prev.onclick = () => stepLightbox(-1);
    if (next) next.onclick = () => stepLightbox(1);
  }
  function openLightbox(id) {
    const list = visibleGuides();
    const i = list.findIndex(g => String(g.id) === String(id));
    lbState = { list, idx: i < 0 ? 0 : i, img: 0 };
    closeLightbox();
    const host = document.createElement('div');
    host.id = 'guide-lightbox';
    host.className = 'lightbox';
    host.addEventListener('click', e => { if (e.target === host) closeLightbox(); });
    document.body.appendChild(host);
    document.addEventListener('keydown', lightboxKeys);
    drawLightbox();
  }

  // ---------- Student reviews ----------
  async function renderReviews() {
    await loadReviews();
    const list = reviewsCache || [];
    const avg = list.length ? (list.reduce((s, r) => s + (Number(r.rating) || 0), 0) / list.length) : 0;
    let mine = [];
    if (db && session) { const q = await db.from('reviews').select('id,rating,body,context,status,admin_reply,created_at').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(5); if (!q.error) mine = q.data || []; }
    const cards = list.map(r => `<article class="card review-card">${stars(r.rating)}<h3>${esc(r.name || 'A student')}</h3><span class="kicker">${esc(r.context || 'Initial test')} · ${fmtDate(r.created_at)}</span><p><strong>${esc(r.body)}</strong></p>${r.admin_reply ? `<div class="reply"><strong>Academy response:</strong> ${esc(r.admin_reply)}</div>` : ''}</article>`).join('');
    return wrap(`${pageHead('Student reviews', 'Experiences from our students', 'Reviews written by students who prepared with ISSB ASPIRANTS material and sat the initial test. Published after academy review.')}
    <div class="stat-grid"><div class="stat-card green"><strong>${list.length}</strong><span>Reviews published</span></div><div class="stat-card"><strong>${avg ? avg.toFixed(1) : '—'}</strong><span>Average rating out of 5</span></div><div class="stat-card amber"><strong>${list.filter(r => r.admin_reply).length}</strong><span>Academy responses</span></div></div>
    <div class="grid grid-3" style="margin-top:20px">${cards || empty('No reviews published yet', 'Be the first to share your experience after your initial test.', '★')}</div>
    ${mine.length ? `<section class="section" style="padding-bottom:0"><div class="section-head"><h2>Your reviews</h2></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Rating</th><th>Context</th><th>Your review</th><th>Status</th><th>Academy response</th></tr></thead><tbody>${mine.map(r => `<tr><td>${stars(r.rating)}</td><td>${esc(r.context || '—')}</td><td class="muted" style="max-width:280px">${esc(r.body)}</td><td><span class="status ${r.status === 'published' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}">${esc(r.status)}</span></td><td class="muted">${esc(r.admin_reply || '—')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <div class="notice info" style="margin-top:22px"><strong>Share your experience:</strong> ${session ? 'open your dashboard and use the “Share your experience” panel. Reviews appear here once the academy publishes them.' : 'sign in with your student account, then use the “Share your experience” panel on your dashboard.'} ${session ? buttonLink('dashboard', 'Go to dashboard') : buttonLink('auth', 'Student login')}</div>`);
  }

  // ---------- Student experiences ----------
  const EXP_RESULTS = ['Initial test cleared', 'ISSB recommended', 'Reappear — preparing again', 'Still preparing'];
  const expChip = r => `exp-chip ${r === 'ISSB recommended' ? 'rec' : r === 'Initial test cleared' ? 'clear' : r === 'Reappear — preparing again' ? 'reap' : 'prep'}`;

  async function renderExperiences() {
    await loadExperiences();
    const list = experiencesCache || [];
    const cards = list.map(x => `<article class="card exp-card"><span class="${expChip(x.result)}">${esc(x.result)}</span><h3>${esc(x.name)}</h3><span class="kicker">${fmtDate(x.created_at)}</span><p>${esc(x.body)}</p>${x.helped_with ? `<p class="exp-helped">Prepared with: ${esc(x.helped_with)}</p>` : ''}${x.admin_reply ? `<div class="reply"><strong>Academy response:</strong> ${esc(x.admin_reply)}</div>` : ''}</article>`).join('');
    return wrap(`${pageHead('Student experiences', 'Real stories from students who prepared here', 'Students who sat the initial test or ISSB after preparing with ISSB ASPIRANTS share what actually happened — in their own words. Every story is checked by the academy before it appears on this page.')}
    <div class="stat-grid"><div class="stat-card green"><strong>${list.length}</strong><span>Experiences published</span></div><div class="stat-card"><strong>${list.filter(x => x.result === 'ISSB recommended').length}</strong><span>ISSB recommended</span></div><div class="stat-card amber"><strong>${list.filter(x => x.result === 'Initial test cleared').length}</strong><span>Initial test cleared</span></div></div>
    <div class="grid grid-3" style="margin-top:20px">${cards || empty('No experiences published yet', 'Students and visitors can share their story below — it appears here once the academy publishes it.', '🎖')}</div>
    <form id="experience-form" class="form-card" style="margin-top:26px"><h2>Share your experience</h2><p class="muted">Sat the initial test or ISSB after preparing with our material? Tell the next batch of students what actually happened. Your story stays hidden until the academy publishes it.</p>
    <div class="form-grid"><div class="field"><label for="exp-name">Your name</label><input id="exp-name" name="name" required maxlength="80" autocomplete="name"></div>
    <div class="field"><label for="exp-result">Your result</label><select id="exp-result" name="result">${EXP_RESULTS.map(r => `<option>${esc(r)}</option>`).join('')}</select></div>
    <div class="field full"><label for="exp-body">Your experience</label><textarea id="exp-body" name="body" required minlength="20" maxlength="4000" placeholder="How did you prepare, what did the test or ISSB feel like, and what helped you the most?"></textarea></div>
    <div class="field full"><label for="exp-helped">What helped from ISSB ASPIRANTS? (optional)</label><input id="exp-helped" name="helped_with" maxlength="120" placeholder="e.g. Notes library, practice tests, interview video"></div>
    <div class="hp-field" aria-hidden="true"><label>Leave this field empty</label><input name="website" tabindex="-1" autocomplete="off"></div></div>
    <div class="form-actions"><button class="btn btn-primary" type="submit">Submit for publication →</button></div>
    <p class="form-note">No login needed. Submissions are reviewed by the academy — only published stories are visible to visitors.</p></form>`);
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
    return wrap(`${pageHead(freeOnly ? 'Free library' : 'Study resources', 'Notes Library', freeOnly ? 'Free notes are open to every approved student account. No email verification is needed — the owner approves your account.' : 'Browse the published catalogue. Restricted PDFs are served only to approved students with the required access.')}
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
    return wrap(`${pageHead('Student portal', 'Create your student account', 'Registration has exactly four fields. After you register, the owner approves your account and your notes access opens immediately — no email verification required.')}
    <div class="form-card"><div class="tabs"><button class="tab active" data-auth-mode="login">Login</button><button class="tab" data-auth-mode="register">Create account</button></div><div id="auth-notice">${configured ? '' : '<div style="margin-bottom:16px">' + configNotice() + '</div>'}</div>
    <form id="auth-form"><div id="register-fields" class="form-grid hidden"><div class="field full"><label for="full-name">Full name</label><input id="full-name" name="full_name" maxlength="120" autocomplete="name"></div><div class="field full"><label for="phone">Phone / WhatsApp</label><input id="phone" name="phone" type="tel" maxlength="30" autocomplete="tel" placeholder="03xx xxxxxxx"></div></div><div class="field" style="margin-top:12px"><label for="email">Email address</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="email"></div><div class="field" style="margin-top:12px"><label for="password">Password</label><input id="password" name="password" type="password" required minlength="8" autocomplete="current-password"><span class="form-note">Use at least 8 characters. Never share your password.</span></div><div class="form-actions"><button class="btn btn-primary" type="submit" id="auth-submit">Login →</button><button class="btn btn-outline" type="button" id="forgot-password">Forgot password?</button></div><p class="form-note">After registering you can sign in right away. Notes access opens as soon as the owner approves your account.</p></form></div>`);
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
    let myReviews = [], threads = [], msgs = [];
    if (db) {
      const rq = await db.from('reviews').select('id,rating,body,context,status,admin_reply,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10);
      if (!rq.error) myReviews = rq.data || [];
      const tq = await db.from('threads').select('id,subject,status,last_message_at').eq('user_id', user.id).order('last_message_at', { ascending: false }).limit(25);
      if (!tq.error) threads = tq.data || [];
      openThreadId = threads.length ? (threads.some(t => t.id === openThreadId) ? openThreadId : threads[0].id) : null;
      if (openThreadId) { const mq = await db.from('thread_messages').select('id,sender_id,body,created_at').eq('thread_id', openThreadId).order('created_at'); if (!mq.error) msgs = mq.data || []; }
    }
    const banner = status === 'approved' ? '' : status === 'rejected'
      ? `<div class="notice error" style="margin-bottom:20px"><strong>Account status: Rejected.</strong> Your account was not approved. Please contact the academy on WhatsApp (${esc(c.whatsapp)}) for clarification.</div>`
      : status === 'suspended'
        ? `<div class="notice error" style="margin-bottom:20px"><strong>Account status: Suspended.</strong> Protected resources are paused. Contact the academy on WhatsApp (${esc(c.whatsapp)}) to discuss restoration.</div>`
        : `<div class="notice info" style="margin-bottom:20px"><strong>Account status: Pending.</strong> Your account is waiting for owner approval — you do <strong>not</strong> need to verify your email to get access. Resources open automatically as soon as the owner approves you.</div>`;
    return wrap(`<div class="dashboard-top"><div><span class="eyebrow">Student dashboard</span><h1>Welcome, ${esc(me.full_name || user.email)}</h1><p>${esc(user.email)} · Your account and resource access at a glance.</p></div><div><span class="status ${esc(status)}">${esc(statusLabel(status))}</span><div class="form-actions"><button class="btn btn-secondary" id="logout-btn">Sign out</button></div></div></div>
    ${banner}
    <div class="grid grid-3"><article class="card"><span class="kicker">Account</span><h3>${esc(statusLabel(status))}</h3><p>Email confirmation (optional): ${user.email_confirmed_at ? 'Verified' : 'Not verified — not required for access'}</p><div class="form-actions"><button class="btn btn-outline" id="reset-password-btn">Send password reset</button></div></article><article class="card"><span class="kicker">Active packages</span><h3>${ent.length}</h3><p>Only packages granted by the owner appear here.</p></article><article class="card"><span class="kicker">Support</span><h3>Need help?</h3><p>Message the academy on WhatsApp.</p><div class="form-actions"><a class="btn btn-outline" href="${waLink(c.whatsapp)}" target="_blank" rel="noopener noreferrer">Contact support ↗</a></div></article></div>
    <section class="section" style="padding-bottom:0"><div class="section-head"><h2>Your packages</h2></div>${ent.length ? `<div class="grid grid-3">${ent.map(e => `<article class="card"><span class="status approved">Active</span><h3>${esc(e.packages?.name || 'Preparation package')}</h3><p>Lifetime access is currently active.</p></article>`).join('')}</div>` : empty('No active packages', 'Purchase requests that are verified and approved by the owner will appear here.', '▤')}<div class="form-actions">${buttonLink('packages', 'Explore packages')}${buttonLink('free-notes', 'Free notes', 'btn btn-outline')}${buttonLink('notes', 'Browse notes', 'btn btn-outline')}</div></section>
    <section class="section" style="padding-bottom:0"><div class="section-head"><h2>Your payment requests</h2></div>${myPayments.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Package</th><th>Amount</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${myPayments.map(p => `<tr><td>${esc(p.package_name_snapshot || p.package_id)}</td><td>${money(p.amount_pkr)}</td><td><span class="status ${esc(p.status)}">${esc(p.status)}</span></td><td>${fmtDate(p.created_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No payment requests yet', 'When you request a package, its verification status will appear here.', '₨')}</section>
    <section class="section" style="padding-bottom:0"><div class="section-head"><h2>Messages to the academy</h2><p>Response panel — a direct conversation with the owner or an admin.</p></div>
    <div class="thread-layout"><aside class="thread-list">${threads.length ? threads.map(t => `<button type="button" class="thread-item ${t.id === openThreadId ? 'on' : ''}" data-thread="${esc(t.id)}"><strong>${esc(t.subject)}</strong><small>${fmtDate(t.last_message_at)} · ${esc(t.status)}</small></button>`).join('') : '<p class="muted" style="padding:12px">No conversations yet.</p>'}</aside>
    <div class="thread-main">${openThreadId ? `<div class="bubbles">${msgs.length ? msgs.map(m => `<div class="bubble ${m.sender_id === user.id ? 'me' : 'them'}"><span class="who">${m.sender_id === user.id ? 'You' : 'Academy'}</span><p>${esc(m.body)}</p><small>${fmtDate(m.created_at)}</small></div>`).join('') : '<p class="muted">No messages in this conversation yet.</p>'}</div><form id="thread-reply" class="inline-form"><input name="body" required maxlength="3000" placeholder="Write your reply…"><button class="btn btn-primary" type="submit">Send →</button></form>` : '<p class="muted">Start a conversation below to message the academy.</p>'}</div></div>
    <form id="thread-new" class="card" style="margin-top:16px"><h3>Start a new conversation</h3><div class="form-grid"><div class="field"><label>Subject</label><input name="subject" required maxlength="150" placeholder="e.g. Question about a package"></div><div class="field full"><label>Message</label><textarea name="body" required maxlength="3000"></textarea></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Send to academy →</button></div></form></section>
    <section class="section" style="padding-bottom:0"><div class="section-head"><h2>Share your experience</h2><p>Write a review after your initial test — it helps the next batch of students.</p></div>
    <form id="review-form" class="card"><div class="form-grid"><div class="field"><label>Rating</label><select name="rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)}${'☆'.repeat(5 - n)} (${n})</option>`).join('')}</select></div><div class="field"><label>What did you attempt?</label><input name="context" maxlength="80" value="Initial test"></div><div class="field full"><label>Your experience</label><textarea name="body" required maxlength="1500" placeholder="How did the notes, tests and guidance help you?"></textarea></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Submit review</button></div><p class="form-note">Reviews appear on the public Reviews page once the academy publishes them. Your name is taken from your profile.</p></form>
    ${myReviews.length ? `<div class="table-wrap" style="margin-top:14px"><table class="data-table"><thead><tr><th>Rating</th><th>Context</th><th>Your review</th><th>Status</th><th>Academy response</th><th>Date</th></tr></thead><tbody>${myReviews.map(r => `<tr><td>${stars(r.rating)}</td><td>${esc(r.context || '—')}</td><td class="muted" style="max-width:260px">${esc(r.body)}</td><td><span class="status ${r.status === 'published' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}">${esc(r.status)}</span></td><td class="muted">${esc(r.admin_reply || '—')}</td><td>${fmtDate(r.created_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}</section>`);
  }

  // ================= ADMIN DASHBOARD =================
  const ADMIN_TABS = [
    ['overview', 'Overview', '▦'], ['students', 'Students', '👥'], ['packages', 'Packages', '▣'],
    ['payments', 'Payments', '₨'], ['resources', 'Notes & PDFs', '▤'], ['tests', 'Practice tests', '◈'],
    ['guidance', 'Guidance', '✦'], ['reviews', 'Reviews', '★'], ['experiences', 'Experiences', '🎖'], ['responses', 'Responses', '💬'],
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
      const [users, ents, pkgs, emails] = await Promise.all([
        db.from('profiles').select('id,full_name,phone,status,role,created_at').order('created_at', { ascending: false }).limit(500),
        db.from('entitlements').select('user_id,package_id,active,packages(name)'),
        db.from('packages').select('id,name').order('sort_order'),
        db.rpc('admin_student_emails')
      ]);
      A.users = users.data || []; A.ents = ents.data || []; A.pkgs = pkgs.data || [];
      A.emails = {}; (emails.data || []).forEach(e => { A.emails[e.user_id] = e; });
    }
    if (tab === 'packages') { const q = await db.from('packages').select('*').order('sort_order'); A.packages = q.data || []; }
    if (tab === 'payments') { const q = await db.from('payment_requests').select('id,user_id,package_id,package_name_snapshot,transaction_ref,amount_pkr,status,created_at,reviewed_at,receipt_path').order('created_at', { ascending: false }).limit(200); A.payments = q.data || []; }
    if (tab === 'resources') { const [res, pkgs] = await Promise.all([db.from('resources').select('id,title,category,subject,file_type,access_type,is_preview,package_id,published,storage_path,created_at').order('created_at', { ascending: false }).limit(500), db.from('packages').select('id,name').order('sort_order')]); A.resources = res.data || []; A.pkgs = pkgs.data || []; await loadPackageResources(); }
    if (tab === 'tests') { const q = await db.from('practice_tests').select('*').order('created_at', { ascending: false }).limit(200); A.tests = q.data || []; }
    if (tab === 'announcements') { const q = await db.from('announcements').select('*').order('created_at', { ascending: false }).limit(200); A.announcements = q.data || []; }
    if (tab === 'guidance') { const q = await db.from('guides').select('*').order('sort_order').order('created_at', { ascending: false }).limit(300); A.guides = q.data || []; }
    if (tab === 'reviews') { const q = await db.from('reviews').select('*').order('created_at', { ascending: false }).limit(300); A.reviews = q.data || []; }
    if (tab === 'experiences') { const q = await db.from('experiences').select('*').order('created_at', { ascending: false }).limit(300); A.experiences = q.data || []; }
    if (tab === 'responses') {
      const [t, p] = await Promise.all([
        db.from('threads').select('id,user_id,subject,status,last_message_at,created_at').order('last_message_at', { ascending: false }).limit(200),
        db.from('profiles').select('id,full_name,phone')
      ]);
      A.threads = t.data || [];
      A.threadNames = {}; (p.data || []).forEach(x => { A.threadNames[x.id] = x; });
      if (!A.threads.some(x => x.id === A.openThread)) A.openThread = A.threads.length ? A.threads[0].id : null;
      A.threadMsgs = [];
      if (A.openThread) { const m = await db.from('thread_messages').select('id,sender_id,body,created_at').eq('thread_id', A.openThread).order('created_at'); if (!m.error) A.threadMsgs = m.data || []; }
    }
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
    const users = A.users || [], ents = A.ents || [], pkgs = A.pkgs || [], emails = A.emails || {};
    const entFor = uid => ents.filter(e => e.user_id === uid && e.active).map(e => e.packages?.name || e.package_id);
    const rows = users.map(u => {
      const isStudent = u.role === 'student';
      const mine = entFor(u.id);
      const em = emails[u.id];
      let actions = '—';
      let emailCell = '—';
      if (isStudent) {
        const btns = [];
        if (u.status !== 'approved') btns.push(`<button class="btn btn-outline" data-user-action="${esc(u.id)}" data-status="approved">Approve</button>`);
        if (u.status !== 'rejected') btns.push(`<button class="btn btn-danger" data-user-action="${esc(u.id)}" data-status="rejected">Reject</button>`);
        if (u.status === 'approved') btns.push(`<button class="btn btn-danger" data-user-action="${esc(u.id)}" data-status="suspended">Suspend</button>`);
        if (u.status === 'suspended') btns.push(`<button class="btn btn-outline" data-user-action="${esc(u.id)}" data-status="approved">Restore</button>`);
        const wa = studentReminderLink(u, em);
        if (wa) btns.push(`<a class="btn btn-outline" target="_blank" rel="noopener noreferrer" href="${esc(wa)}">WhatsApp</a>`);
        actions = `<div class="row-actions">${btns.join('')}</div>`;
        emailCell = em
          ? `${esc(em.email || '—')}<br><span class="status ${em.email_verified ? 'approved' : 'rejected'}">${em.email_verified ? 'Email verified' : 'Email NOT verified'}</span>`
          : '<span class="muted">Email hidden</span>';
      }
      return `<tr data-searchrow="${esc((u.full_name || '') + ' ' + (u.phone || '') + ' ' + (em && em.email || '') + ' ' + u.status)}"><td>${esc(u.full_name || '—')}</td><td>${esc(u.phone || '—')}</td><td>${emailCell}</td><td><span class="status ${esc(u.status)}">${esc(u.status)}</span></td><td>${esc(u.role)}</td><td class="muted">${mine.length ? mine.map(esc).join(', ') : (isStudent ? 'None' : '—')}</td><td>${fmtDate(u.created_at)}</td><td>${actions}</td></tr>`;
    }).join('');
    return `<section class="admin-panel"><h2>Student management</h2><p class="muted">Approve only after checking the account. Email verification is <strong>not</strong> required any more — pressing Approve gives the student notes access immediately. If a student has not verified their email or has not logged in yet, use the WhatsApp button to send them a reminder in one click.</p>
    <div class="filter-bar"><input type="search" id="student-search" placeholder="Search name, phone, email or status…"></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Status</th><th>Role</th><th>Packages</th><th>Joined</th><th>Actions</th></tr></thead><tbody id="student-rows">${rows || '<tr><td colspan="8">No accounts found.</td></tr>'}</tbody></table></div>
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

  // Pictures staged for the guide form: existing ones plus newly uploaded ones.
  let guideDraftImages = [];
  function guideStripHtml() {
    if (!guideDraftImages.length) return '<p class="muted" style="margin:0">No pictures in this entry yet.</p>';
    return `<div class="thumb-strip">${guideDraftImages.map((u, i) => `<span class="thumb"><img src="${esc(u)}" alt="Picture ${i + 1}" loading="lazy"><button type="button" class="thumb-x" data-remove-image="${i}" aria-label="Remove picture">&times;</button></span>`).join('')}</div>`;
  }
  function bindStripRemovals() {
    $$('#guide-existing [data-remove-image]').forEach(b => b.addEventListener('click', () => {
      guideDraftImages.splice(Number(b.getAttribute('data-remove-image')), 1);
      refreshGuideStrip();
    }));
  }
  function refreshGuideStrip() { const host = $('#guide-existing'); if (host) { host.innerHTML = guideStripHtml(); bindStripRemovals(); } }
  const catOptions = sel => `<optgroup label="Interview attire — own gallery">
      <option value="formal-suit"${sel === 'formal-suit' ? ' selected' : ''}>Formal suit gallery</option>
      <option value="shalwar-kameez"${sel === 'shalwar-kameez' ? ' selected' : ''}>Shalwar kameez gallery</option>
    </optgroup>
    <optgroup label="Guidance &amp; video">
      <option value="video-guidance"${sel === 'video-guidance' ? ' selected' : ''}>Video guidance</option>
      <option value="interview-tips"${sel === 'interview-tips' || sel === 'interview' ? ' selected' : ''}>Interview tips</option>
      <option value="information"${sel === 'information' ? ' selected' : ''}>Information</option>
      <option value="call"${sel === 'call' ? ' selected' : ''}>Interview call</option>
      <option value="other"${sel === 'other' || sel === 'tips' ? ' selected' : ''}>Other guidance</option>
    </optgroup>`;

  function adminGuidance() {
    const list = A.guides || [];
    return `<section class="admin-panel"><h2>Guidance centre</h2><p class="muted">Two separate attire galleries — <strong>Formal suit</strong> and <strong>Shalwar kameez</strong> — plus video guidance, interview tips, information and interview calls. Choose the category first, then upload the pictures that belong to that gallery. Each gallery is shown separately to students on the public Guidance page.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Title</th><th>Category / gallery</th><th>Media</th><th>Points</th><th>Published</th><th>Order</th><th>Actions</th></tr></thead><tbody>${list.map(g => { const n = guideImages(g).length; return `<tr><td>${esc(g.title)}</td><td><span class="tag">${esc(guideCat(g.category))}</span>${isAttireCat(g.category) ? ' <span class="tag free">gallery</span>' : ''}</td><td class="muted">${n ? `🖼 ${n} picture${n > 1 ? 's' : ''}` : '— no picture'}${g.video_url ? ' · ▶ video' : ''}</td><td>${(g.points || []).filter(p => String(p || '').trim()).length}</td><td><span class="status ${g.published ? 'approved' : ''}">${g.published ? 'yes' : 'no'}</span></td><td>${g.sort_order || 0}</td><td><div class="row-actions"><button class="btn btn-outline" data-edit-guide="${esc(g.id)}">Edit</button><button class="btn btn-danger" data-delete-guide="${esc(g.id)}">Delete</button></div></td></tr>`; }).join('') || '<tr><td colspan="7">No guidance added yet.</td></tr>'}</tbody></table></div>
    <form id="guide-form" class="card" style="margin-top:20px"><h3 id="guide-form-title">Add guidance</h3><input type="hidden" name="editing" value="">
      <div class="form-grid">
        <div class="field"><label>Category / gallery — choose this first</label><select name="category">${catOptions('formal-suit')}</select></div>
        <div class="field"><label>Title</label><input name="title" required maxlength="160" placeholder="e.g. Formal suit — colours that work"></div>
        <div class="field full"><label>Short summary</label><textarea name="summary" maxlength="600"></textarea></div>
        <div class="field full"><label>Points (one per line — shown in bold to students)</label><textarea name="points" maxlength="4000" placeholder="Reach the board 30 minutes early&#10;Carry your original CNIC and call letter&#10;Answer honestly, do not memorise"></textarea></div>
        <div class="field full"><label>Gallery pictures — select several at once (max 5 MB each)</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></div>
        <div class="field full"><label>Pictures already in this entry</label><div id="guide-existing">${guideStripHtml()}</div></div>
        <div class="field full"><label>…or paste a picture URL to add to this gallery</label><input name="image_url" type="url" placeholder="https://…"></div>
        <div class="field full"><label>Video link (YouTube, Vimeo or direct .mp4)</label><input name="video_url" type="url" placeholder="https://www.youtube.com/watch?v=…"></div>
        <div class="field full"><label>Video file (optional, max 50 MB — a YouTube link is safer for long videos)</label><input name="video" type="file" accept="video/mp4,video/webm"></div>
        <div class="field"><label>Display order</label><input name="sort_order" type="number" value="0"></div>
      </div>
      <label class="checkline"><input type="checkbox" name="published" checked> Publish immediately</label>
      <div class="progress hidden" id="guide-progress"><span></span></div>
      <div class="form-actions"><button class="btn btn-primary" type="submit" id="guide-save">Save guidance</button><button class="btn btn-outline" type="button" id="guide-reset">Clear</button></div></form></section>`;
  }

  function adminReviews() {
    const list = A.reviews || [];
    return `<section class="admin-panel"><h2>Student reviews</h2><p class="muted">Reviews submitted by students from their dashboard. Nothing is public until you publish it. Add an academy response and it shows under the review on the public page.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Student</th><th>Rating</th><th>Context</th><th>Review</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map(r => `<tr><td>${esc(r.name || '—')}</td><td>${stars(r.rating)}</td><td>${esc(r.context || '—')}</td><td class="muted" style="max-width:300px;white-space:pre-wrap">${esc(r.body)}${r.admin_reply ? `<br><strong>Reply:</strong> ${esc(r.admin_reply)}` : ''}</td><td><span class="status ${r.status === 'published' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}">${esc(r.status)}</span></td><td><div class="row-actions">${r.status !== 'published' ? `<button class="btn btn-outline" data-review-status="${esc(r.id)}" data-status="published">Publish</button>` : ''}${r.status !== 'rejected' ? `<button class="btn btn-danger" data-review-status="${esc(r.id)}" data-status="rejected">Reject</button>` : ''}<button class="btn btn-secondary" data-review-reply="${esc(r.id)}">Reply</button><button class="btn btn-danger" data-review-delete="${esc(r.id)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="6">No reviews submitted yet.</td></tr>'}</tbody></table></div></section>`;
  }

  function adminExperiences() {
    const list = A.experiences || [];
    return `<section class="admin-panel"><h2>Student experiences</h2><p class="muted">Stories submitted from the public Experiences page — by students and by visitors (tagged <em>visitor</em>). Nothing goes public until you publish it. Reject or delete anything you cannot stand behind; an academy response shows under the published story.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Result</th><th>Story</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map(x => `<tr><td>${esc(x.name)}${x.user_id ? '' : ' <span class="status pending">visitor</span>'}</td><td><span class="${expChip(x.result)}">${esc(x.result)}</span></td><td class="muted" style="max-width:320px;white-space:pre-wrap">${esc(x.body)}${x.helped_with ? `<br><strong>Helped by:</strong> ${esc(x.helped_with)}` : ''}${x.admin_reply ? `<br><strong>Reply:</strong> ${esc(x.admin_reply)}` : ''}</td><td><span class="status ${x.status === 'published' ? 'approved' : x.status === 'rejected' ? 'rejected' : 'pending'}">${esc(x.status)}</span></td><td><div class="row-actions">${x.status !== 'published' ? `<button class="btn btn-outline" data-exp-status="${esc(x.id)}" data-status="published">Publish</button>` : ''}${x.status !== 'rejected' ? `<button class="btn btn-danger" data-exp-status="${esc(x.id)}" data-status="rejected">Reject</button>` : ''}<button class="btn btn-secondary" data-exp-reply="${esc(x.id)}">Reply</button><button class="btn btn-danger" data-exp-delete="${esc(x.id)}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="5">No experiences submitted yet.</td></tr>'}</tbody></table></div></section>`;
  }

  function adminResponses() {
    const threads = A.threads || [], names = A.threadNames || {}, msgs = A.threadMsgs || [];
    const open = threads.find(t => t.id === A.openThread) || null;
    const who = id => { const p = names[id]; return (p && (p.full_name || p.phone)) || 'Student'; };
    return `<section class="admin-panel"><h2>Response panel</h2><p class="muted">Two-way conversations started by students from their dashboard. Your reply appears in their Messages panel immediately.</p>
    <div class="thread-layout"><aside class="thread-list">${threads.length ? threads.map(t => `<button type="button" class="thread-item ${t.id === A.openThread ? 'on' : ''}" data-open-thread="${esc(t.id)}"><strong>${esc(t.subject)}</strong><small>${esc(who(t.user_id))} · ${fmtDate(t.last_message_at)} · ${esc(t.status)}</small></button>`).join('') : '<p class="muted" style="padding:12px">No conversations yet.</p>'}</aside>
    <div class="thread-main">${open ? `<div class="bubbles">${msgs.length ? msgs.map(m => `<div class="bubble ${m.sender_id === open.user_id ? 'them' : 'me'}"><span class="who">${m.sender_id === open.user_id ? esc(who(open.user_id)) : 'Academy (you)'}</span><p>${esc(m.body)}</p><small>${fmtDate(m.created_at)}</small></div>`).join('') : '<p class="muted">No messages yet.</p>'}</div>
    <form id="admin-thread-reply" class="inline-form"><input type="hidden" name="thread_id" value="${esc(open.id)}"><input name="body" required maxlength="3000" placeholder="Write your reply…"><button class="btn btn-primary" type="submit">Send →</button></form>
    <div class="form-actions" style="margin-top:10px">${open.status === 'open' ? `<button class="btn btn-outline" data-thread-status="${esc(open.id)}" data-status="closed">Close conversation</button>` : `<button class="btn btn-outline" data-thread-status="${esc(open.id)}" data-status="open">Reopen conversation</button>`}<a class="btn btn-secondary" href="${waLink((names[open.user_id] || {}).phone)}" target="_blank" rel="noopener noreferrer">WhatsApp this student ↗</a><button class="btn btn-danger" data-thread-delete="${esc(open.id)}">Delete conversation</button></div>` : '<p class="muted">Select a conversation on the left.</p>'}</div></div></section>`;
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
      case 'guidance': return adminGuidance();
      case 'reviews': return adminReviews();
      case 'experiences': return adminExperiences();
      case 'responses': return adminResponses();
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
  const renderers = { home: renderHome, about: renderAbout, packages: renderPackages, notes: () => renderNotes(false), 'free-notes': () => renderNotes(true), tests: renderTests, guidance: renderGuidance, reviews: renderReviews, experiences: renderExperiences, announcements: renderAnnouncements, contact: renderContact, auth: renderAuth, dashboard: renderDashboard, admin: renderAdmin };

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
    if (!isApproved()) { toast(profile && profile.status === 'suspended' ? 'Your account is suspended.' : 'Wait for owner approval before requesting a package.'); location.hash = '#dashboard'; return; }
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

  // ---------- Guidance media upload + save ----------
  // The bucket/tables only exist after supabase-content-update.sql has been run,
  // so turn Supabase's raw storage errors into something the owner can act on.
  function friendlyUploadError(error) {
    const m = String((error && error.message) || '');
    if (/bucket not found/i.test(m)) return 'The "guidance-media" storage bucket does not exist yet. Open Supabase → SQL Editor and run supabase-content-update.sql (section 6 creates the bucket), then upload again.';
    if (/permission denied|row-level security|new row violates/i.test(m)) return 'Upload refused by the database. Make sure supabase-content-update.sql has been run and that you are signed in as owner/admin.';
    if (/maximum size|too large|entity too large/i.test(m)) return 'That file is larger than the bucket allows (50 MB). Use a YouTube link for long videos.';
    return m || 'Upload failed.';
  }

  async function saveGuide(existing) {
    const form = $('#guide-form');
    const f = new FormData(form);
    const title = String(f.get('title') || '').trim();
    if (!title) { toast('Enter a title.'); return; }
    const category = String(f.get('category') || 'other');
    const btn = $('#guide-save'), bar = $('#guide-progress');
    const imgFiles = [...(form.querySelector('input[name="images"]').files || [])];
    const vidFile = (form.querySelector('input[name="video"]').files || [])[0];
    const pastedImage = String(f.get('image_url') || '').trim();
    let video_url = String(f.get('video_url') || '').trim();
    if (pastedImage && !/^https:\/\//i.test(pastedImage)) { toast('The picture URL must start with https://'); return; }
    if (video_url && !/^https:\/\//i.test(video_url)) { toast('The video URL must start with https://'); return; }
    btn.disabled = true;
    try {
      const images = guideDraftImages.slice();
      if (imgFiles.length || vidFile) { bar.classList.remove('hidden'); bar.classList.add('busy'); }
      const ext = (name, fb) => String(name || '').split('.').pop().toLowerCase() || fb;
      for (let i = 0; i < imgFiles.length; i++) {
        const file = imgFiles[i];
        if (file.size > 5242880) throw new Error(`"${file.name}" is bigger than 5 MB — compress it first.`);
        // Pictures are filed under their gallery so each category stays separate in storage too.
        const p = `images/${category}/${slug(title)}-${Date.now()}-${i}.${ext(file.name, 'jpg')}`;
        const { error } = await db.storage.from('guidance-media').upload(p, file, { contentType: file.type || 'image/jpeg', upsert: false });
        if (error) throw new Error(friendlyUploadError(error));
        images.push(mediaUrl(p));
      }
      if (pastedImage && images.indexOf(pastedImage) < 0) images.push(pastedImage);
      if (vidFile) {
        if (vidFile.size > 52428800) throw new Error('Videos must be 50 MB or smaller — for longer videos paste a YouTube link instead.');
        const p = `videos/${category}/${slug(title)}-${Date.now()}.${ext(vidFile.name, 'mp4')}`;
        const { error } = await db.storage.from('guidance-media').upload(p, vidFile, { contentType: vidFile.type || 'video/mp4', upsert: false });
        if (error) throw new Error(friendlyUploadError(error));
        video_url = mediaUrl(p);
      }
      bar.classList.remove('busy'); bar.classList.add('hidden');
      const row = {
        title,
        category,
        summary: String(f.get('summary') || '').trim(),
        points: String(f.get('points') || '').split('\n').map(s => s.trim()).filter(Boolean),
        image_urls: images,
        image_url: images[0] || '',
        video_url,
        sort_order: Number(f.get('sort_order') || 0),
        published: f.get('published') === 'on'
      };
      let error;
      if (existing) ({ error } = await db.from('guides').update(row).eq('id', existing.id));
      else { row.created_by = session.user.id; ({ error } = await db.from('guides').insert(row)); }
      if (error) throw new Error(friendlyUploadError(error));
      toast(existing ? 'Guidance updated.' : `Saved to the ${guideCat(category)}${isAttireCat(category) ? ' gallery' : ' section'}.`);
      guideDraftImages = [];
      form.reset(); form.querySelector('[name="editing"]').value = ''; $('#guide-form-title').textContent = 'Add guidance';
      refreshGuideStrip();
      await reloadAdmin();
    } catch (err) { bar.classList.remove('busy'); bar.classList.add('hidden'); toast(err.message || 'Could not save guidance.'); }
    finally { btn.disabled = false; }
  }

  // ---------- Response panel messaging ----------
  async function sendThreadMessage(f) {
    const thread_id = String(f.get('thread_id') || openThreadId || '');
    const body = String(f.get('body') || '').trim();
    if (!db || !session) { toast('Sign in first.'); return; }
    if (!thread_id) { toast('Open or start a conversation first.'); return; }
    if (!body) { toast('Write a message first.'); return; }
    const { error } = await db.from('thread_messages').insert({ thread_id, sender_id: session.user.id, body });
    if (error) { toast(error.message); return; }
    toast('Message sent.');
    if (isAdmin()) await reloadAdmin(); else await render('dashboard');
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
          toast(data.session ? 'Account created. The owner will approve it shortly — you can already sign in.' : 'Account created. Check your email to confirm the address, then wait for owner approval.');
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

    // Guidance centre
    const guideForm = $('#guide-form');
    bindStripRemovals();
    $$('[data-edit-guide]').forEach(b => b.addEventListener('click', () => {
      const g = (A.guides || []).find(x => x.id === b.dataset.editGuide); if (!g || !guideForm) return;
      guideForm.querySelector('[name="editing"]').value = g.id;
      guideForm.querySelector('[name="title"]').value = g.title || '';
      guideForm.querySelector('[name="category"]').value = g.category || 'formal-suit';
      guideForm.querySelector('[name="summary"]').value = g.summary || '';
      guideForm.querySelector('[name="points"]').value = (g.points || []).join('\n');
      guideForm.querySelector('[name="sort_order"]').value = g.sort_order || 0;
      guideForm.querySelector('[name="video_url"]').value = g.video_url || '';
      // Existing pictures move into the strip, so the URL field stays empty and
      // saving cannot add the same picture twice.
      guideForm.querySelector('[name="image_url"]').value = '';
      guideForm.querySelector('[name="published"]').checked = !!g.published;
      guideDraftImages = guideImages(g);
      refreshGuideStrip();
      $('#guide-form-title').textContent = `Edit guidance — ${guideCat(g.category)}`;
      guideForm.scrollIntoView({ behavior: 'smooth' });
    }));
    $('#guide-reset')?.addEventListener('click', () => {
      guideForm.reset(); guideForm.querySelector('[name="editing"]').value = '';
      guideDraftImages = []; refreshGuideStrip();
      $('#guide-form-title').textContent = 'Add guidance';
    });
    guideForm?.addEventListener('submit', e => {
      e.preventDefault();
      const editing = String(new FormData(guideForm).get('editing') || '');
      saveGuide(editing ? (A.guides || []).find(x => x.id === editing) : null);
    });
    $$('[data-delete-guide]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this guidance item?')) return; const { error } = await db.from('guides').delete().eq('id', b.dataset.deleteGuide); if (error) { toast(error.message); return; } toast('Guidance deleted.'); await reloadAdmin(); }));

    // Student reviews
    $$('[data-review-status]').forEach(b => b.addEventListener('click', async () => { const { error } = await db.from('reviews').update({ status: b.dataset.status }).eq('id', b.dataset.reviewStatus); if (error) { toast(error.message); return; } toast(b.dataset.status === 'published' ? 'Review published on the site.' : 'Review rejected.'); await reloadAdmin(); }));
    $$('[data-review-reply]').forEach(b => b.addEventListener('click', async () => {
      const r = (A.reviews || []).find(x => x.id === b.dataset.reviewReply); if (!r) return;
      const text = prompt('Academy response (shown publicly under the review):', r.admin_reply || '');
      if (text === null) return;
      const { error } = await db.from('reviews').update({ admin_reply: text.trim().slice(0, 1000) }).eq('id', r.id);
      if (error) { toast(error.message); return; } toast('Response saved.'); await reloadAdmin();
    }));
    $$('[data-review-delete]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this review permanently?')) return; const { error } = await db.from('reviews').delete().eq('id', b.dataset.reviewDelete); if (error) { toast(error.message); return; } toast('Review deleted.'); await reloadAdmin(); }));

    // Experiences moderation
    $$('[data-exp-status]').forEach(b => b.addEventListener('click', async () => { const { error } = await db.from('experiences').update({ status: b.dataset.status }).eq('id', b.dataset.expStatus); if (error) { toast(error.message); return; } toast(b.dataset.status === 'published' ? 'Experience published on the site.' : 'Experience rejected.'); await reloadAdmin(); }));
    $$('[data-exp-reply]').forEach(b => b.addEventListener('click', async () => {
      const x = (A.experiences || []).find(v => v.id === b.dataset.expReply); if (!x) return;
      const text = prompt('Academy response shown under this experience:', x.admin_reply || ''); if (text === null) return;
      const { error } = await db.from('experiences').update({ admin_reply: text.trim().slice(0, 1000) }).eq('id', x.id);
      if (error) { toast(error.message); return; } toast('Response saved.'); await reloadAdmin();
    }));
    $$('[data-exp-delete]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this experience permanently?')) return; const { error } = await db.from('experiences').delete().eq('id', b.dataset.expDelete); if (error) { toast(error.message); return; } toast('Experience deleted.'); await reloadAdmin(); }));

    // Response panel
    $$('[data-open-thread]').forEach(b => b.addEventListener('click', () => { A.openThread = b.dataset.openThread; reloadAdmin(); }));
    $('#admin-thread-reply')?.addEventListener('submit', e => { e.preventDefault(); sendThreadMessage(new FormData(e.currentTarget)); });
    $$('[data-thread-status]').forEach(b => b.addEventListener('click', async () => { const { error } = await db.from('threads').update({ status: b.dataset.status }).eq('id', b.dataset.threadStatus); if (error) { toast(error.message); return; } toast(b.dataset.status === 'closed' ? 'Conversation closed.' : 'Conversation reopened.'); await reloadAdmin(); }));
    $$('[data-thread-delete]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this conversation and all of its messages?')) return; const id = b.dataset.threadDelete; const { error } = await db.from('threads').delete().eq('id', id); if (error) { toast(error.message); return; } if (A.openThread === id) A.openThread = null; toast('Conversation deleted.'); await reloadAdmin(); }));

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
      if (error) { toast(error.message); return; } toast('Announcement saved.'); await reloadAdmin(); await loadAnnouncements(); updateTicker();
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

  // ---------- Guidance / reviews / response panel wiring (student + public) ----------
  function wireContent() {
    $$('[data-guide-cat]').forEach(b => b.addEventListener('click', () => { guidesView.cat = b.dataset.guideCat; render('guidance'); }));
    $$('[data-guide-open]').forEach(b => b.addEventListener('click', () => openLightbox(b.dataset.guideOpen)));
    $$('[data-thread]').forEach(b => b.addEventListener('click', () => { openThreadId = b.dataset.thread; render('dashboard'); }));
    $('#thread-reply')?.addEventListener('submit', e => { e.preventDefault(); sendThreadMessage(new FormData(e.currentTarget)); });
    $('#thread-new')?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const subject = String(f.get('subject') || '').trim(), body = String(f.get('body') || '').trim();
      if (!db || !session) { toast('Sign in first.'); return; }
      if (!subject || !body) { toast('Add a subject and a message.'); return; }
      const { data, error } = await db.from('threads').insert({ user_id: session.user.id, subject }).select('id').single();
      if (error) { toast(error.message); return; }
      const m = await db.from('thread_messages').insert({ thread_id: data.id, sender_id: session.user.id, body });
      if (m.error) { toast(m.error.message); return; }
      openThreadId = data.id;
      toast('Message sent to the academy.');
      await render('dashboard');
    });
    $('#review-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const body = String(f.get('body') || '').trim();
      if (!db || !session || !profile) { toast('Sign in first.'); return; }
      if (!body) { toast('Write your experience first.'); return; }
      const row = {
        user_id: session.user.id,
        name: profile.full_name || session.user.email,
        rating: Math.max(1, Math.min(5, Number(f.get('rating')) || 5)),
        body,
        context: String(f.get('context') || '').trim().slice(0, 80) || 'Initial test',
        status: 'pending'
      };
      const { error } = await db.from('reviews').insert(row);
      if (error) { toast(error.message); return; }
      toast('Thank you! Your review appears on the public page once the academy publishes it.');
      await render('dashboard');
    });

    $('#experience-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      // Honeypot: bots fill the hidden field; humans never see it. Pretend success, save nothing.
      if (String(f.get('website') || '').trim()) { toast('Thank you! Your experience will appear once the academy publishes it.'); e.currentTarget.reset(); return; }
      if (!db) { toast('The experiences section is not connected on this server yet.'); return; }
      const name = String(f.get('name') || '').trim();
      const body = String(f.get('body') || '').trim();
      if (name.length < 2) { toast('Please write your name.'); return; }
      if (body.length < 20) { toast('Please write a few sentences about your experience (at least 20 characters).'); return; }
      const result = String(f.get('result') || '');
      const row = {
        user_id: session ? session.user.id : null,
        name: name.slice(0, 80),
        result: EXP_RESULTS.includes(result) ? result : EXP_RESULTS[0],
        body: body.slice(0, 4000),
        helped_with: String(f.get('helped_with') || '').trim().slice(0, 120),
        status: 'pending'
      };
      const { error } = await db.from('experiences').insert(row);
      if (error) { toast(/exist|not find|not found|schema cache|PGRST205|permission/i.test(error.message) ? 'Experiences are not set up on this server yet — please try again later.' : error.message); return; }
      toast('Thank you! Your experience will appear on this page once the academy publishes it.');
      e.currentTarget.reset();
    });
  }

  function wirePage() {
    wireAuth(); wireContact(); wireNotes(); wireAdmin(); wireDownloadButtons(); wireContent();
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
      updateTicker();
    }
    navigate();
  }
  init();
})();
