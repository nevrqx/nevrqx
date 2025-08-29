/*
  nevrqx — Supabase powered minimal blog with smart comments
  ---------------------------------------------------------
  SETUP REQUIRED:
  1) Create a Supabase project and set the env below (SUPABASE_URL, SUPABASE_ANON_KEY)
  2) SQL schema (run in Supabase SQL editor):

  -- auth: use Supabase Auth for admin login
  -- profiles table to mark admins
  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    role text check (role in ('admin','user')) default 'user',
    created_at timestamp with time zone default now()
  );

  -- posts
  create table if not exists public.posts (
    id bigint generated always as identity primary key,
    title text not null,
    slug text unique not null,
    content text not null,
    tags text[] default '{}',
    cover_url text,
    status text not null check (status in ('draft','scheduled','published')) default 'draft',
    pinned boolean default false,
    scheduled_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
  );

  -- comments (anonymous allowed)
  create table if not exists public.comments (
    id bigint generated always as identity primary key,
    post_id bigint not null references public.posts(id) on delete cascade,
    parent_id bigint references public.comments(id) on delete cascade,
    author_name text,
    body text not null,
    score numeric default 0,          -- client heuristic score
    flagged boolean default false,    -- client heuristic flag
    created_at timestamp with time zone default now()
  );

  -- Helpful indexes
  create index if not exists idx_posts_status_time on public.posts(status, published_at desc);
  create index if not exists idx_posts_slug on public.posts(slug);
  create index if not exists idx_comments_post on public.comments(post_id);

  -- RLS
  alter table public.profiles enable row level security;
  alter table public.posts enable row level security;
  alter table public.comments enable row level security;

  -- Only admins can read/write posts fully; public can read published posts
  create policy if not exists "posts_public_read_published" on public.posts
    for select using ( status = 'published' and coalesce(published_at, now()) <= now() );
  create policy if not exists "posts_admin_full" on public.posts
    for all using ( exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') )
    with check ( exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') );

  -- Comments: anyone can read; anyone can insert; update/delete only admin
  create policy if not exists "comments_read_all" on public.comments for select using ( true );
  create policy if not exists "comments_insert_any" on public.comments for insert with check ( true );
  create policy if not exists "comments_admin_update_delete" on public.comments
    for update using ( exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin') )
    with check ( exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin') );
  create policy if not exists "comments_admin_delete" on public.comments
    for delete using ( exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin') );

  -- Trigger to auto published_at when status to published and no published_at provided
  create or replace function public.set_published_at()
  returns trigger language plpgsql as $$
  begin
    if NEW.status = 'published' and NEW.published_at is null then
      NEW.published_at = now();
    end if;
    NEW.updated_at = now();
    return NEW;
  end; $$;
  drop trigger if exists trg_posts_set_times on public.posts;
  create trigger trg_posts_set_times before insert or update on public.posts
  for each row execute function public.set_published_at();

  ---------------------------------------------------------
*/

// Supabase client с безопасным фолбэком (локальный заглушечный клиент)
let client;
try {
  const config = window.getSupabaseConfig();
  const urlOk = typeof config.url === 'string' && /^https:\/\/.+\.supabase\.co\/?$/.test(config.url);
  const keyOk = typeof config.key === 'string' && config.key.length > 40;
  if (urlOk && keyOk) {
    // Сохраняем базовую конфигурацию, чтобы позже создавать изолированные клиенты (например, анонимный для тикетов)
    window.__NVX_SUPA_BASE__ = { url: config.url, key: config.key };
    client = supabase.createClient(config.url, config.key);
  } else {
    console.warn('[nevrqx] Supabase не настроен. Запускаю локальный режим без бэкенда. Заполните window.SUPABASE_URL и window.SUPABASE_ANON_KEY для полноценной работы.');
    // Локальный минимальный клиент, чтобы UI работал без ошибок
    const LocalClient = (() => {
      let session = null;
      const mkOk = (data = []) => ({ data, error: null });
      const mkErr = (msg) => ({ data: null, error: { message: msg } });
      const query = { _table: null, _filters: [],
        select() { return Promise.resolve(mkOk([])); },
        eq() { return this; },
        lte() { return this; },
        order() { return this; },
        maybeSingle() {
          if (this._table === 'profiles') return Promise.resolve(mkOk({ role: 'admin' }));
          return Promise.resolve(mkOk(null));
        },
        insert() { return Promise.resolve(mkOk([])); },
        update() { return Promise.resolve(mkOk([])); },
        delete() { return Promise.resolve(mkOk([])); },
      };
      return {
        auth: {
          async getSession() { return mkOk({ session }); },
          async signInWithPassword({ email }) {
            session = { user: { id: 'local-user', email } };
            return mkOk({ session, user: session.user });
          },
          async signOut() { session = null; return mkOk(); },
        },
        from(table) {
          const q = Object.create(query);
          q._table = table;
          return q;
        },
        channel() { return { on() { return this; }, subscribe() { return this; } }; },
        removeChannel() { /* noop */ },
      };
    })();
    client = LocalClient;
  }

// -------------- Profile Tabs
function initProfileTabs() {
  $$('.profile-tabs [data-profile-tab]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveProfileTab(btn.dataset.profileTab);
    });
  });
}

function setActiveProfileTab(name) {
  state.activeProfileTab = name;
  $$('.profile-tabs [data-profile-tab]')?.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.profileTab === name);
  });
  const sections = {
    tickets: byId('profileSectionTickets'),
    comments: byId('profileSectionComments'),
    notifications: byId('profileSectionNotifications'),
  };
  Object.entries(sections).forEach(([key, el]) => {
    if (!el) return;
    if (key === name) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  });
  // lazy loads per tab
  if (name === 'comments') loadProfile();
  if (name === 'tickets') loadMyTickets();
  if (name === 'notifications') loadNotifications();
  // update counters after DOM renders
  setTimeout(updateProfileTabCounts, 0);
}

function updateProfileTabCounts() {
  try {
    const tc = byId('ticketsCount');
    const cc = byId('commentsCount');
    const nc = byId('notifCount');
    // tickets
    if (tc) {
      const count = state.myTickets?.length || 0;
      tc.textContent = String(count);
      tc.toggleAttribute('hidden', !(count > 0));
    }
    // comments
    if (cc) {
      const count = Array.from(byId('profileComments')?.children || []).length || (state.totalComments || 0);
      cc.textContent = String(count);
      cc.toggleAttribute('hidden', !(count > 0));
    }
    // notifications (unread preferred)
    if (nc) {
      const unread = typeof state.unreadNotifications === 'number' ? state.unreadNotifications : 0;
      const total = state.notifications?.length || 0;
      const val = unread > 0 ? unread : total;
      nc.textContent = String(val);
      nc.toggleAttribute('hidden', !(val > 0));
    }
  } catch {}
}

// Realtime: support tickets/messages
function setupTicketsRealtime() {
  try { if (state.ticketSub) client.removeChannel(state.ticketSub); } catch {}
  const onAny = () => {
    const r = parseHash();
    if (r.page === 'profile') loadMyTickets();
  };
  state.ticketSub = client
    .channel('support_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages' }, onAny)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, onAny)
    .subscribe();
}
  // Удаляем функцию после использования для безопасности
  delete window.getSupabaseConfig;
} catch (error) {
  console.error('Ошибка инициализации клиента:', error);
}

// -------------- DOM helpers
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));

// simple debounce for input handlers
function debounce(fn, wait = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
const byId = (id) => document.getElementById(id);

// highlight helper: safely escape then wrap matches with <mark>
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlightText(text, q) {
  const s = escapeHtml(text || '');
  const query = (q || '').trim();
  if (!query) return s;
  const terms = Array.from(new Set(query.split(/\s+/).filter(Boolean))).map(escapeRegex);
  if (!terms.length) return s;
  const re = new RegExp(`(${terms.join('|')})`, 'gi');
  return s.replace(re, '<mark class="hl">$1</mark>');
}

// -------------- State
const state = {
  postsCache: [],
  currentPost: null,
  isAdmin: false,
  currentSearchQuery: '',
  currentComments: [],
  realtimeChannel: null,
  commentsPage: 1,
  commentsPerPage: 10,
  totalComments: 0,
  isLoadingComments: false,
  userFingerprint: null,
  userLikes: new Set(), // Хранит ID комментариев, которые лайкнул пользователь
  userIP: null,         // Публичный IP пользователя
  lockedName: null,     // Закреплённый ник для этого IP (если есть)
  // Notifications
  notifications: [],
  unreadNotifications: 0,
  notifSub: null,
  ticketSub: null,
  // Tickets (user)
  myTickets: [],
  ticketMessages: new Map(), // ticket_id -> messages[]
  activeTicketId: null,
};

// Генерация отпечатка пользователя
function generateUserFingerprint() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillText('Fingerprint test', 2, 2);
  
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    canvas.toDataURL()
  ].join('|');
  
  // Простой хеш
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// -------------- Navigation handlers
document.addEventListener('DOMContentLoaded', () => {
  // Генерируем отпечаток пользователя
  state.userFingerprint = generateUserFingerprint();
  // Определяем IP и применяем блокировку ника при наличии
  fetchUserIP().then(async () => {
    await checkAndLockName().catch(() => {});
    // После получения IP можно инициализировать уведомления
    initNotificationsUI();
    await loadNotifications();
    setupNotificationsRealtime();
    // Тикеты: realtime
    setupTicketsRealtime();
  }).catch(() => {});
  
  // Обработчики навигации
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      location.hash = href;
    });
  });
  
  // Обработчик изменения хеша
  window.addEventListener('hashchange', onRoute);
  
  // Первоначальная маршрутизация
  onRoute();
  // Глобальные биндинги форм и кнопок
  byId('commentSort')?.addEventListener('change', () => loadComments(state.currentPost?.id));
  byId('commentForm')?.addEventListener('submit', onSubmitComment);
  byId('ticketForm')?.addEventListener('submit', onSubmitTicket);
  // Admin Tickets filters
  byId('adminTicketStatus')?.addEventListener('change', () => loadAdminTickets());
  byId('adminTicketSort')?.addEventListener('change', () => loadAdminTickets());
  byId('notifBell')?.addEventListener('click', toggleNotifPanel);
  byId('notifMarkAll')?.addEventListener('click', markAllNotificationsRead);
  document.addEventListener('click', (e) => {
    const panel = byId('notifPanel');
    const bell = byId('notifBell');
    if (!panel || panel.hidden) return;
    const inside = panel.contains(e.target) || bell.contains(e.target);
    if (!inside) panel.hidden = true;
  });
});

// Получить публичный IP пользователя
async function fetchUserIP() {
  if (state.userIP) return state.userIP;
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const j = await r.json();
    state.userIP = j.ip || null;
  } catch (_) {
    state.userIP = null;
  }
  return state.userIP;
}

// Применить UI блокировку поля имени
function applyNameLockUI() {
  const input = byId('commentName');
  if (!input) return;
  if (state.lockedName) {
    input.value = state.lockedName;
    input.disabled = true;
    input.title = 'Ник закреплён за вашим IP и не может быть изменён';
  } else {
    input.disabled = false;
    input.title = '';
  }
}

// Проверить/подтянуть закреплённый ник по IP
async function checkAndLockName() {
  try {
    if (!state.userIP) await fetchUserIP();
    if (!state.userIP) return;
    const { data, error } = await client
      .from('ip_names')
      .select('author_name')
      .eq('ip', state.userIP)
      .maybeSingle();
    if (!error && data && data.author_name) {
      state.lockedName = data.author_name;
    }
  } catch (_) { /* noop */ }
  applyNameLockUI();
}

// -------------- Routing (hash)
const routes = {
  home: byId('route-home'),
  post: byId('route-post'),
  profile: byId('route-profile'),
  admin: byId('route-admin'),
};

function showRoute(name) {
  Object.values(routes).forEach(el => el.setAttribute('hidden', ''));
  routes[name]?.removeAttribute('hidden');
}

function parseHash() {
  const h = location.hash || '#/';
  // allow both '#/route' and '#route' formats
  const raw = h.startsWith('#/') ? h.slice(2) : h.startsWith('#') ? h.slice(1) : h;
  const parts = raw.split('/').filter(Boolean);
  // patterns: home => '', 'home'; post => 'p/:slug'; admin => 'admin'
  if (parts.length === 0 || parts[0] === 'home') return { page: 'home' };
  if (parts[0] === 'p' && parts[1]) return { page: 'post', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'profile') return { page: 'profile' };
  if (parts[0] === 'admin') return { page: 'admin' };
  return { page: 'home' };
}

window.addEventListener('hashchange', onRoute);
async function onRoute() {
  const r = parseHash();
  if (r.page === 'home') {
    showRoute('home');
    // Сбрасываем поиск при переходе на главную, чтобы не скрывать публикации фильтром
    const gs = byId('globalSearch');
    if (gs && gs.value) gs.value = '';
    await loadHome();
  } else if (r.page === 'post') {
    showRoute('post');
    await openPostBySlug(r.slug);
  } else if (r.page === 'profile') {
    showRoute('profile');
    await loadProfile();
    await loadMyTickets();
    initProfileTabs();
    setActiveProfileTab(state.activeProfileTab || 'tickets');
  } else if (r.page === 'admin') {
    showRoute('admin');
    await ensureAuthUI();
  }
}

// -------------- Profile
async function loadProfile() {
  // ensure IP and locked name state
  await fetchUserIP().catch(() => {});
  await checkAndLockName().catch(() => {});

  // Fill header fields
  const nameEl = byId('profileName');
  const ipEl = byId('profileIP');
  if (nameEl) nameEl.textContent = state.lockedName || 'Гость';
  if (ipEl) ipEl.textContent = state.userIP || '—';

  const emptyEl = byId('profileEmpty');
  const listEl = byId('profileComments');
  if (listEl) listEl.innerHTML = '';

  if (!state.userIP) {
    if (emptyEl) { emptyEl.textContent = 'Не удалось определить IP. Комментарии привязываются к IP.'; emptyEl.hidden = false; }
    return;
  }

  // Fetch user's comments by IP
  const { data: comments, error: e1 } = await client
    .from('comments')
    .select('id, post_id, parent_id, author_name, body, created_at, flagged, author_is_admin, likes_count')
    .eq('user_ip', state.userIP)
    .order('created_at', { ascending: false })
    .limit(200);
  if (e1) { console.error('loadProfile comments:', e1); if (emptyEl) { emptyEl.textContent = 'Ошибка загрузки комментариев.'; emptyEl.hidden = false; } return; }

  if (!comments || !comments.length) {
    if (emptyEl) { emptyEl.textContent = 'Комментариев ещё нет. Оставьте первый комментарий под любой публикацией.'; emptyEl.hidden = false; }
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  // Fetch posts meta for linking
  const postIds = Array.from(new Set(comments.map(c => c.post_id).filter(Boolean)));
  let postMap = new Map();
  if (postIds.length) {
    const { data: posts, error: e2 } = await client
      .from('posts')
      .select('id, slug, title')
      .in('id', postIds);
    if (!e2 && posts) posts.forEach(p => postMap.set(p.id, p));
  }

  // Render simple flat list of user's comments
  for (const c of comments) {
    const el = document.createElement('div');
    el.className = `comment${c.flagged ? ' flagged' : ''}`;
    const post = postMap.get(c.post_id);
    const postLink = post ? `<a class="post-link" href="#/p/${encodeURIComponent(post.slug)}">${escapeHtml(post.title || 'Пост')}</a>` : `<span class="post-link muted">Пост #${c.post_id}</span>`;
    const name = (c.author_name || 'Гость').trim();
    const initial = escapeHtml((name[0] || '?').toUpperCase());
    el.innerHTML = `
      <div class="comment-header">
        <div class="comment-author">
          <div class="avatar">${initial}</div>
          <span class="comment-author-name">${escapeHtml(name)}</span>
          ${c.author_is_admin ? '<span class="admin-label" title="Администратор">АДМИН</span>' : ''}
        </div>
        <div class="comment-meta small text-muted">${postLink} · ${formatDate(c.created_at)}</div>
      </div>
      <div class="comment-body">${renderMarkdownInline(escapeHtml(c.body || ''))}</div>
      <div class="comment-actions">
        <span class="like-count">👍 ${Number(c.likes_count || 0)}</span>
      </div>
    `;
    listEl?.appendChild(el);
  }
}

// -------------- Auth & Admin
async function getSession() {
  const { data } = await client.auth.getSession();
  state.session = data.session || null;
  state.user = data.session?.user || null;
  return state.session;
}

async function checkIsAdmin(userId) {
  if (!userId) return false;
  // Попытка 1: схема, где profiles.id = uuid (как в заголовке файла)
  let { data, error } = await client
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  // Если тип несовместим (например, id = bigint), пробуем по user_id
  const typeErr = !!error && /invalid input syntax for type bigint|22P02|column "id" does not exist/i.test(error.message || '');
  if (typeErr || (!data && !error)) {
    const r2 = await client
      .from('profiles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();
    if (r2.error) { console.warn('profiles role error (user_id)', r2.error); return false; }
    return r2.data?.role === 'admin';
  }
  if (error) { console.warn('profiles role error (id)', error); return false; }
  return data?.role === 'admin';
}

async function ensureAuthUI() {
  const session = await getSession();
  state.session = session || state.session;
  state.isAdmin = await checkIsAdmin(session?.user?.id);
  const authEl = byId('adminAuth');
  const panelEl = byId('adminPanel');
  const hideAuth = !!state.isAdmin;
  const hidePanel = !state.isAdmin;
  // attribute toggle
  authEl.hidden = hideAuth;
  panelEl.hidden = hidePanel;
  // class toggle as defensive fallback
  authEl.classList.toggle('hidden', hideAuth);
  panelEl.classList.toggle('hidden', hidePanel);
  // Persist admin hint for other pages (e.g., ticket.html) to read
  try {
    if (state.isAdmin) {
      localStorage.setItem('nvx_is_admin', '1');
      localStorage.setItem('nvx_admin_email', session?.user?.email || '');
    } else {
      localStorage.removeItem('nvx_is_admin');
      localStorage.removeItem('nvx_admin_email');
    }
  } catch (_) { /* noop */ }
  if (state.isAdmin) {
    // Инициализация табов (один раз)
    initAdminTabs();
    // Стартовый таб
    setActiveAdminTab(state.activeAdminTab || 'posts');
  }
  // Загрузка комментариев для модерации
  if (state.isAdmin && (state.activeAdminTab || 'posts') === 'comments') await loadAdminComments();
}

// ---- Админ: комментарии — загрузка, фильтрация и действия
async function loadAdminComments() {
  const sort = byId('adminCommentSort')?.value || 'desc';
  const status = byId('adminCommentAnswered')?.value || 'all';
  // 1) Загружаем верхнеуровневые комментарии
  const { data: parents, error: e1 } = await client
    .from('comments')
    .select('*')
    .is('parent_id', null)
    .order('created_at', { ascending: sort === 'asc' })
    .limit(100);
  if (e1) { console.error('loadAdminComments parents:', e1); return; }
  const parentIds = (parents || []).map(c => c.id);
  // 2) Загружаем ответы к ним
  let replies = [];
  if (parentIds.length) {
    const { data: rs, error: e2 } = await client
      .from('comments')
      .select('*')
      .in('parent_id', parentIds);
    if (e2) { console.error('loadAdminComments replies:', e2); }
    replies = rs || [];
  }
  // 3) Определяем статус (есть ли админ-ответ)
  const replyMap = new Map();
  for (const r of replies) {
    const arr = replyMap.get(r.parent_id) || [];
    arr.push(r);
    replyMap.set(r.parent_id, arr);
  }
  const items = (parents || []).map(p => {
    const rs = replyMap.get(p.id) || [];
    const hasAdminReply = rs.some(x => x.author_is_admin);
    return { parent: p, replies: rs, hasAdminReply };
  });
  // 4) Фильтрация по статусу
  const filtered = items.filter(it =>
    status === 'all' ? true : status === 'answered' ? it.hasAdminReply : !it.hasAdminReply
  );
  renderAdminCommentsList(filtered);
}

function renderAdminCommentsList(items) {
  const root = byId('adminCommentsList');
  if (!root) return;
  root.innerHTML = '';
  if (!items?.length) {
    root.innerHTML = '<div class="muted">Нет комментариев по заданным фильтрам.</div>';
    return;
  }
  for (const it of items) {
    const c = it.parent;
    const el = document.createElement('div');
    el.className = 'admin-comment-item';
    const name = (c.author_name || 'Гость').trim();
    const initial = escapeHtml((name[0] || '?').toUpperCase());
    el.innerHTML = `
      <div class="item-head">
        <div class="item-head-left">
          <div class="admin-avatar">${initial}</div>
          <div class="admin-head-text">
            <div class="item-author">${escapeHtml(name)} ${c.author_is_admin ? '<span class="admin-label" title="Администратор">АДМИН</span>' : ''}</div>
            <div class="item-meta">
              <span class="chip">#${c.id}</span>
              <span class="chip">пост ${c.post_id}</span>
              <span class="chip">${formatDate(c.created_at)}</span>
              ${it.hasAdminReply ? '<span class="chip success">С ответом</span>' : ''}
            </div>
          </div>
        </div>
        <div class="item-head-right">
          <button class="btn ghost" data-admin-reply="${c.id}">Ответить как nevrqx</button>
          <button class="btn danger" data-del="${c.id}">Удалить</button>
        </div>
      </div>
      <div class="item-body">${renderMarkdownInline(escapeHtml(c.body))}</div>
      ${it.replies?.length ? `
        <div class="replies">
          ${it.replies.map(r => {
            const rn = (r.author_name || 'Гость').trim();
            return `
              <div class="reply">
                <div class="reply-meta small text-muted">
                  <strong>${escapeHtml(rn)}</strong> · ${formatDate(r.created_at)}
                </div>
                <div class="reply-body">${renderMarkdownInline(escapeHtml(r.body))}</div>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}
    `;
    // actions
    el.querySelector('[data-admin-reply]')?.addEventListener('click', () => adminReplyTo(c));
    el.querySelector('[data-del]')?.addEventListener('click', () => adminDeleteComment(c.id));
    root.appendChild(el);
  }
}

async function adminReplyTo(comment) {
  const body = await modalPrompt('Ответ администратора', 'Введите текст…');
  if (!body) return;
  const { error } = await client.from('comments').insert({
    post_id: comment.post_id,
    parent_id: comment.id,
    author_name: 'nevrqx',
    body,
    flagged: false,
    user_ip: state.userIP || null,
    author_is_admin: true
  });
  if (error) return alert('Не удалось отправить ответ: ' + error.message);
  await loadAdminComments();
}

async function adminDeleteComment(id) {
  const ok = await modalConfirm('Удалить комментарий #' + id + '?', 'Подтверждение удаления', 'Удалить', true);
  if (!ok) return;
  const { error } = await client.from('comments').delete().eq('id', id);
  if (error) return alert('Ошибка удаления: ' + error.message);
  await loadAdminComments();
}

byId('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = byId('email').value.trim();
  const password = byId('password').value;
  const errEl = byId('loginError');
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  // 0) Базовая валидация до запроса к серверу
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const passOk = typeof password === 'string' && password.length >= 6;
  if (!emailOk || !passOk) {
    if (errEl) {
      errEl.innerHTML = '<strong>Ошибка:</strong> Проверьте формат email и длину пароля (не менее 6 символов).';
      errEl.hidden = false;
    }
    await modalConfirm(
      'Данные введены некорректно. Если вы продолжите подбирать данные, вы будете заблокированы администрацией вручную.',
      'Внимание',
      'Понял',
      true
    );
    return;
  }
  // 1) Пытаемся войти
  let { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    // Лог для диагностики, чтобы понять реальное содержимое ошибки от Supabase
    console.debug('Auth error:', { message: error?.message, name: error?.name, status: error?.status, code: error?.code });
  }
  const looksLikeInvalid = !!error && (
    /invalid\s+login\s+credentials/i.test(error?.message || '') ||
    /invalid\s+credentials/i.test(error?.message || '') ||
    error?.status === 400 || error?.status === 401 ||
    (typeof error?.code === 'string' && /invalid/i.test(error.code))
  );
  if (looksLikeInvalid) {
    if (errEl) {
      errEl.innerHTML = '<strong>Неверные данные:</strong> Электронная почта или пароль указаны неверно.';
      errEl.hidden = false;
    }
    await modalConfirm(
      'Данные для входа неверны. Если вы продолжите подбирать данные, вы будете заблокированы администрацией вручную.',
      'Внимание',
      'Понял',
      true
    );
    return; // Прекращаем дальнейшие действия, не пытаемся регистрировать
  } else if (error) {
    if (errEl) {
      errEl.innerHTML = '<strong>Ошибка авторизации:</strong> ' + escapeHtml(error?.message || 'Неизвестная ошибка');
      errEl.hidden = false;
    }
    await modalConfirm('Ошибка входа: ' + (error?.message || 'Неизвестная ошибка'), 'Ошибка авторизации', 'ОК', true);
    return;
  }
  // Строгий фолбэк: нет явной ошибки, но сессии/пользователя нет
  if (!data?.session || !data?.user) {
    if (errEl) {
      errEl.innerHTML = '<strong>Ошибка:</strong> Не удалось создать сессию. Повторите попытку.';
      errEl.hidden = false;
    }
    await modalConfirm('Вход не завершён: сервер не вернул сессию. Повторите попытку позже.', 'Ошибка авторизации', 'ОК', true);
    return;
  }
  state.session = data.session;
  state.user = data.user;
  // Если этот пользователь — целевой админ, пытаемся повысить права через RPC (если доступно)
  try {
    const adminEmail = (window.ADMIN_EMAIL || '').trim().toLowerCase();
    const userEmail = (state.user?.email || '').trim().toLowerCase();
    if (adminEmail && userEmail && adminEmail === userEmail) {
      await client.rpc('make_admin', { target_email: state.user.email });
    }
  } catch (e) {
    console.warn('make_admin RPC not available or failed:', e?.message || e);
  }
  state.isAdmin = await checkIsAdmin(state.user?.id);
  if (!state.isAdmin) {
    if (errEl) {
      errEl.innerHTML = '<strong>Доступ запрещён:</strong> У вашей учётной записи нет прав администратора.';
      errEl.hidden = false;
    }
    await modalConfirm('У вас нет прав администратора. Обратитесь к владельцу или назначьте роль admin.', 'Доступ запрещён', 'ОК', true);
    await client.auth.signOut();
    return;
  }
  await ensureAuthUI();
});

byId('logoutBtn').addEventListener('click', async () => {
  await client.auth.signOut();
  state.session = null; state.user = null; state.isAdmin = false;
  await ensureAuthUI();
});

byId('newPostBtn').addEventListener('click', () => openEditor());
byId('closeEditor').addEventListener('click', () => byId('editorDialog').close());
byId('editorForm').addEventListener('submit', onSavePost);
byId('deletePostBtn').addEventListener('click', onDeletePost);
// schedule toggle visibility
const toggleScheduleEl = byId('toggle_schedule');
const scheduleWrapEl = byId('schedule_wrap');
if (toggleScheduleEl) {
  toggleScheduleEl.addEventListener('change', () => {
    if (toggleScheduleEl.checked) scheduleWrapEl.classList.remove('hidden');
    else scheduleWrapEl.classList.add('hidden');
  });
}

// -------------- Posts (public)
async function loadHome() {
  const q = (byId('globalSearch')?.value || '').trim().toLowerCase();
  const { data, error } = await client
    .from('posts')
    .select('id, title, slug, description, tags, cover_url, published_at, created_at, pinned')
    .eq('status', 'published')
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false });
  if (error) { console.error(error); return; }
  state.postsCache = data || [];
  // simple filtering by search query
  const items = q
    ? state.postsCache.filter(p =>
        p.title?.toLowerCase().includes(q)
        || (p.description || '').toLowerCase().includes(q)
        || (p.tags || []).join(',').toLowerCase().includes(q)
      )
    : state.postsCache;
  state.currentSearchQuery = q;
  renderPosts(items);
}

function renderPosts(items) {
  const root = byId('posts');
  root.innerHTML = '';
  if (!items?.length) { byId('homeEmpty').hidden = false; return; }
  byId('homeEmpty').hidden = true;
  for (const p of items) {
    const el = document.createElement('div');
    const isHit = !!(state.currentSearchQuery && state.currentSearchQuery.length);
    el.className = `post-card${isHit ? ' search-hit' : ''}`;
    el.innerHTML = `
      ${p.cover_url ? `<div class="cover" style="background-image:url('${encodeURI(p.cover_url)}')"></div>` : ''}
      <div class="body">
        <div class="meta">${formatDate(p.published_at || p.created_at)} ${p.pinned ? ' · 📌' : ''}</div>
        <div class="title">${highlightText(p.title, state.currentSearchQuery)}</div>
        ${p.description ? `<div class="desc">${highlightText(p.description, state.currentSearchQuery)}</div>` : ''}
        <div class="tags">${(p.tags||[]).map(t => `<span class="tag">${highlightText(t, state.currentSearchQuery)}</span>`).join('')}</div>
      </div>
      <div class="actions"><button class="btn" data-slug="${p.slug}">Читать →</button></div>
    `;
    el.querySelector('button').addEventListener('click', () => {
      location.hash = `#/p/${encodeURIComponent(p.slug)}`;
    });
    root.appendChild(el);
  }
}

const handleGlobalSearch = () => {
  const q = (byId('globalSearch')?.value || '').trim().toLowerCase();
  const items = q
    ? state.postsCache.filter(p =>
        (p.title || '').toLowerCase().includes(q)
        || (p.description || '').toLowerCase().includes(q)
        || (p.tags || []).join(',').toLowerCase().includes(q)
      )
    : state.postsCache;
  state.currentSearchQuery = q;
  renderPosts(items);
};
byId('globalSearch')?.addEventListener('input', debounce(handleGlobalSearch, 200));
byId('globalSearch')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); handleGlobalSearch(); }
});
$('.search-container .search-icon')?.addEventListener('click', handleGlobalSearch);

// -------------- Single Post + Comments
async function openPostBySlug(slug) {
  const { data: post, error } = await client
    .from('posts')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !post) { alert('Пост не найден'); location.hash = '#/'; return; }
  state.currentPost = post;
  renderPost(post);
  await loadComments(post.id);
  setupRealtime(post.id);
}

function renderPost(p) {
  const cover = byId('postCover');
  if (p.cover_url) { cover.style.backgroundImage = `url('${encodeURI(p.cover_url)}')`; cover.hidden = false; } else cover.hidden = true;
  byId('postTitle').textContent = p.title;
  byId('postMeta').textContent = `${formatDate(p.published_at || p.created_at)}${p.pinned ? ' · 📌 закреплён' : ''}`;
  byId('postContent').innerHTML = renderMarkdown(p.content || '');
  const tagsRoot = byId('postTags');
  tagsRoot.innerHTML = (p.tags||[]).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
}

byId('commentSort').addEventListener('change', () => loadComments(state.currentPost?.id));
byId('commentForm').addEventListener('submit', onSubmitComment);

async function loadComments(postId, page = 1) {
  if (state.isLoadingComments) return;
  
  state.isLoadingComments = true;
  showCommentsLoading();
  
  const sort = byId('commentSort')?.value || 'top';
  const offset = (page - 1) * state.commentsPerPage;
  
  // Получаем общее количество комментариев
  const { count } = await client
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  
  state.totalComments = count || 0;
  
  // Получаем комментарии для текущей страницы
  let query = client
    .from('comments')
    .select('*')
    .eq('post_id', postId)
    .range(offset, offset + state.commentsPerPage - 1);
  
  if (sort === 'top') {
    query = query.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }
  
  const { data, error } = await query;
  if (error) { 
    console.error(error);
    state.isLoadingComments = false;
    hideCommentsLoading();
    return;
  }
  
  state.currentComments = data || [];
  state.commentsPage = page;
  state.isLoadingComments = false;
  
  // Загружаем информацию о лайках пользователя
  await loadUserLikes(postId);
  
  hideCommentsLoading();
  renderComments();
  renderCommentsPagination();
}

async function loadUserLikes(postId) {
  if (!state.userFingerprint) return;
  
  try {
    const { data } = await client
      .from('comment_likes')
      .select('comment_id')
      .eq('user_fingerprint', state.userFingerprint)
      .in('comment_id', state.currentComments.map(c => c.id));
    
    state.userLikes.clear();
    if (data) {
      data.forEach(like => state.userLikes.add(like.comment_id));
    }
  } catch (error) {
    console.error('Ошибка загрузки лайков:', error);
  }
}

function renderComments() {
  const root = byId('commentsList');
  root.innerHTML = '';
  
  if (!state.currentComments || state.currentComments.length === 0) {
    root.innerHTML = '<div class="loading-text">Комментариев пока нет. Будьте первым!</div>';
    return;
  }
  
  // Группируем комментарии по parent_id для создания иерархии
  const topLevel = state.currentComments.filter(c => !c.parent_id);
  const replies = state.currentComments.filter(c => c.parent_id);
  
  for (const c of topLevel) {
    renderComment(c, root, 0);
    // Рендерим ответы к этому комментарию
    const commentReplies = replies.filter(r => r.parent_id === c.id);
    for (const reply of commentReplies) {
      renderComment(reply, root, 1);
    }
  }
}

function renderComment(c, container, level = 0) {
  const el = document.createElement('div');
  const replyClass = level > 0 ? `reply level-${Math.min(level, 3)}` : '';
  const isLiked = state.userLikes.has(c.id);
  const name = (c.author_name || 'Гость').trim();
  const initial = escapeHtml((name[0] || '?').toUpperCase());
  const adminClass = c.author_is_admin ? 'comment-admin' : '';
  el.className = `comment ${replyClass} ${adminClass} ${c.flagged ? 'flagged': ''}`;

  const parentComment = level > 0 ? state.currentComments.find(p => p.id === c.parent_id) : null;
  const replyIndicator = parentComment ?
    `<div class="reply-indicator">в ответ ${escapeHtml(parentComment.author_name || 'Гость')}</div>` : '';

  // Показываем кнопку "Ответить" только для основных комментариев (не ответов)
  const canReply = !c.parent_id;

  el.innerHTML = `
    <div class="comment-header">
      <div class="comment-author">
        <div class="avatar">${initial}</div>
        <span class="comment-author-name">${escapeHtml(name)}</span>
        ${c.author_is_admin ? '<span class="admin-label" title="Администратор">АДМИН</span>' : ''}
        ${c.flagged ? '<span class="comment-author-badge">⚠</span>' : ''}
      </div>
      <span class="comment-time">${formatDate(c.created_at)}</span>
    </div>
    ${replyIndicator}
    <div class="comment-body">${renderMarkdownInline(escapeHtml(c.body))}</div>
    <div class="comment-actions">
      ${canReply ? `<button class="comment-action" data-reply="${c.id}" title="Ответить">
        <span>↩</span> Ответить
      </button>` : ''}
      <button class="comment-action ${isLiked ? 'liked' : ''}" data-like="${c.id}" title="Нравится">
        <span>${isLiked ? '❤️' : '👍'}</span> <span class="like-count">${Number(c.likes_count || 0)}</span>
      </button>
      ${state.isAdmin ? `<button class="comment-action danger" data-del="${c.id}" title="Удалить">🗑 Удалить</button>`: ''}
    </div>
  `;

  if (canReply) {
    el.querySelector('[data-reply]')?.addEventListener('click', () => startReply(c));
  }
  el.querySelector('[data-like]')?.addEventListener('click', () => likeComment(c.id));
  if (state.isAdmin) el.querySelector('[data-del]')?.addEventListener('click', () => deleteComment(c.id));
  container.appendChild(el);
}

function renderCommentsPagination() {
  const pagination = byId('commentsPagination');
  if (!pagination) return;
  
  pagination.innerHTML = '';
  
  const pages = Math.ceil(state.totalComments / state.commentsPerPage);
  if (pages <= 1) return;
  
  // Кнопка "Назад"
  const prevBtn = document.createElement('button');
  prevBtn.innerHTML = '←';
  prevBtn.className = 'pagination-btn';
  prevBtn.disabled = state.commentsPage === 1;
  prevBtn.addEventListener('click', () => loadComments(state.currentPost?.id, state.commentsPage - 1));
  pagination.appendChild(prevBtn);
  
  // Номера страниц
  const startPage = Math.max(1, state.commentsPage - 2);
  const endPage = Math.min(pages, state.commentsPage + 2);
  
  if (startPage > 1) {
    const firstBtn = document.createElement('button');
    firstBtn.textContent = '1';
    firstBtn.className = 'pagination-btn';
    firstBtn.addEventListener('click', () => loadComments(state.currentPost?.id, 1));
    pagination.appendChild(firstBtn);
    
    if (startPage > 2) {
      const dots = document.createElement('span');
      dots.textContent = '...';
      dots.className = 'pagination-info';
      pagination.appendChild(dots);
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = `pagination-btn ${i === state.commentsPage ? 'active' : ''}`;
    btn.addEventListener('click', () => loadComments(state.currentPost?.id, i));
    pagination.appendChild(btn);
  }
  
  if (endPage < pages) {
    if (endPage < pages - 1) {
      const dots = document.createElement('span');
      dots.textContent = '...';
      dots.className = 'pagination-info';
      pagination.appendChild(dots);
    }
    
    const lastBtn = document.createElement('button');
    lastBtn.textContent = pages;
    lastBtn.className = 'pagination-btn';
    lastBtn.addEventListener('click', () => loadComments(state.currentPost?.id, pages));
    pagination.appendChild(lastBtn);
  }
  
  // Кнопка "Вперед"
  const nextBtn = document.createElement('button');
  nextBtn.innerHTML = '→';
  nextBtn.className = 'pagination-btn';
  nextBtn.disabled = state.commentsPage === pages;
  nextBtn.addEventListener('click', () => loadComments(state.currentPost?.id, state.commentsPage + 1));
  pagination.appendChild(nextBtn);
  
  // Информация о странице
  const info = document.createElement('div');
  info.className = 'pagination-info';
  info.textContent = `Страница ${state.commentsPage} из ${pages} (${state.totalComments} комментариев)`;
  pagination.appendChild(info);
}

function showCommentsLoading() {
  const loading = byId('commentsLoading');
  loading.hidden = false;
}

function hideCommentsLoading() {
  const loading = byId('commentsLoading');
  loading.hidden = true;
}

function startReply(comment) {
  // Запрещаем отвечать на комментарии, которые уже являются ответами
  if (comment.parent_id) {
    alert('Нельзя отвечать на комментарий, который уже является ответом. Ответьте на основной комментарий.');
    return;
  }
  
  const form = byId('commentForm');
  const textarea = byId('commentBody');
  const nameInput = byId('commentName');
  
  // Устанавливаем parent_id для ответа
  textarea.dataset.parentId = comment.id;
  
  // Показываем индикатор ответа
  let replyIndicator = form.querySelector('.reply-indicator-form');
  if (!replyIndicator) {
    replyIndicator = document.createElement('div');
    replyIndicator.className = 'reply-indicator-form';
    form.insertBefore(replyIndicator, form.firstChild);
  }
  
  replyIndicator.innerHTML = `
    <span>↳ Ответ на комментарий ${escapeHtml(comment.author_name || 'Гость')}</span>
    <button type="button" class="btn ghost small" onclick="cancelReply()">✕</button>
  `;
  
  // Фокус на форме
  textarea.focus();
  textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelReply() {
  const form = byId('commentForm');
  const textarea = byId('commentBody');
  const replyIndicator = form.querySelector('.reply-indicator-form');
  
  // Убираем parent_id
  delete textarea.dataset.parentId;
  
  // Убираем индикатор
  if (replyIndicator) {
    replyIndicator.remove();
  }
}

async function likeComment(commentId) {
  if (!state.userFingerprint) return;
  
  try {
    const comment = state.currentComments.find(c => c.id === commentId);
    if (!comment) return;
    
    const isLiked = state.userLikes.has(commentId);
    
    if (isLiked) {
      // Убираем лайк
      const { error } = await client
        .from('comment_likes')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_fingerprint', state.userFingerprint);
      
      if (error) {
        console.error('Ошибка удаления лайка:', error);
        return;
      }
      
      // Обновляем локальное состояние
      state.userLikes.delete(commentId);
      comment.likes_count = Math.max((comment.likes_count || 0) - 1, 0);
      
    } else {
      // Добавляем лайк
      const { error } = await client
        .from('comment_likes')
        .insert({
          comment_id: commentId,
          user_fingerprint: state.userFingerprint,
          user_ip: null // IP будет определен на сервере
        });
      
      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          console.log('Лайк уже поставлен');
          return;
        }
        console.error('Ошибка добавления лайка:', error);
        return;
      }
      
      // Обновляем локальное состояние
      state.userLikes.add(commentId);
      comment.likes_count = (comment.likes_count || 0) + 1;
    }
    
    // Обновляем UI
    const likeBtn = document.querySelector(`[data-like="${commentId}"]`);
    if (likeBtn) {
      const countSpan = likeBtn.querySelector('.like-count');
      const iconSpan = likeBtn.querySelector('span:first-child');
      
      if (countSpan) {
        countSpan.textContent = comment.likes_count;
      }
      
      if (iconSpan) {
        iconSpan.textContent = state.userLikes.has(commentId) ? '❤️' : '👍';
      }
      
      likeBtn.classList.toggle('liked', state.userLikes.has(commentId));
      
      // Визуальный эффект
      likeBtn.classList.add('active');
      setTimeout(() => likeBtn.classList.remove('active'), 200);
    }
    
  } catch (err) {
    console.error('Ошибка лайка:', err);
  }
}

async function onSubmitComment(e) {
  e.preventDefault();
  if (!state.currentPost) return;
  const inputEl = byId('commentName');
  const proposedName = (inputEl?.value || '').trim().slice(0, 60) || 'Гость';
  const author_name = state.lockedName || proposedName;
  const body = byId('commentBody').value.trim();
  const parentId = Number(byId('commentBody').dataset.parentId || '') || null;
  if (!body) return;
  const heur = heuristics(body, author_name);
  const { error } = await client.from('comments').insert({
    post_id: state.currentPost.id,
    author_name,
    body,
    parent_id: parentId,
    flagged: heur.flagged,
    user_ip: state.userIP || null
  });
  if (error) return alert('Ошибка: ' + error.message);
  // Если ника ещё не было — после первого успешного коммента он закрепится триггером
  if (!state.lockedName) {
    state.lockedName = author_name;
    applyNameLockUI();
  }
  byId('commentName').value = state.lockedName || '';
  byId('commentBody').value = '';
  delete byId('commentBody').dataset.parentId;
  
  // Убираем индикатор ответа
  cancelReply();
  
  await loadComments(state.currentPost.id);
  // На случай гонок с триггером — перепроверим с сервера
  checkAndLockName();

  // После первого комментария — редирект в профиль
  try {
    if (state.userIP) {
      const { count } = await client
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('user_ip', state.userIP);
      if ((count || 0) === 1) {
        location.hash = '#/profile';
      }
    }
  } catch (_) { /* noop */ }
}

// Слушатели фильтров админ-комментариев
byId('adminCommentSort')?.addEventListener('change', () => loadAdminComments());
byId('adminCommentAnswered')?.addEventListener('change', () => loadAdminComments());

// ------- Admin Tabs logic
function initAdminTabs() {
  const tabsRoot = document.querySelector('.dashboard-tabs');
  if (!tabsRoot || tabsRoot.dataset.bound) return;
  tabsRoot.dataset.bound = '1';
  tabsRoot.querySelectorAll('[data-admin-tab]')?.forEach(btn => {
    btn.addEventListener('click', () => setActiveAdminTab(btn.dataset.adminTab));
  });
}

function setActiveAdminTab(name) {
  state.activeAdminTab = name;
  // toggle buttons
  document.querySelectorAll('.dashboard-tabs [data-admin-tab]')?.forEach(b => {
    b.classList.toggle('active', b.dataset.adminTab === name);
  });
  // toggle sections
  const sections = {
    posts: byId('adminSectionPosts'),
    tickets: byId('adminSectionTickets'),
    comments: byId('adminSectionComments'),
    settings: byId('adminSectionSettings'),
  };
  Object.entries(sections).forEach(([key, el]) => {
    if (!el) return;
    if (key === name) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  });
  // lazy load per tab
  if (name === 'posts') loadAdminPosts();
  if (name === 'comments') loadAdminComments();
  if (name === 'tickets') loadAdminTickets();
}

async function deleteComment(id) {
  const ok = await modalConfirm('Удалить комментарий?', 'Подтверждение удаления', 'Удалить', true);
  if (!ok) return;
  const { error } = await client.from('comments').delete().eq('id', id);
  if (error) alert('Ошибка удаления: ' + error.message);
}

// -------------- Realtime
let postSub = null, commentSub = null;
function setupRealtime(postId) {
  // unsubscribe previous
  if (postSub) client.removeChannel(postSub);
  if (commentSub) client.removeChannel(commentSub);

  postSub = client
    .channel('posts_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, async (payload) => {
      const r = parseHash();
      if (r.page === 'home') loadHome();
      if (r.page === 'post' && state.currentPost && payload.new?.id === state.currentPost.id) {
        const { data } = await client.from('posts').select('*').eq('id', state.currentPost.id).maybeSingle();
        if (data) renderPost(data);
      }
    })
    .subscribe();

  commentSub = client
    .channel(`comments_${postId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, () => {
      loadComments(postId);
    })
    .subscribe();
}

// -------------- Admin: CRUD posts
function openEditor(post) {
  byId('editorTitle').textContent = post ? 'Редактировать пост' : 'Новый пост';
  byId('deletePostBtn').hidden = !post;
  byId('post_title').value = post?.title || '';
  byId('post_slug').value = post?.slug || '';
  // tags UI удалены — пропускаем
  byId('post_cover_url').value = post?.cover_url || '';
  byId('post_description').value = post?.description || '';
  byId('post_content').value = post?.content || '';
  byId('post_status').value = post?.status || 'draft';
  byId('post_scheduled_at').value = post?.scheduled_at ? toLocalInput(post.scheduled_at) : '';
  byId('post_pinned').checked = !!post?.pinned;
  byId('editorDialog').dataset.editId = post?.id || '';
  byId('editorDialog').showModal();
  // initialize schedule toggle
  const shouldSchedule = !!(post && post.status === 'scheduled' && post.scheduled_at);
  if (toggleScheduleEl) {
    toggleScheduleEl.checked = shouldSchedule;
    if (shouldSchedule) scheduleWrapEl.classList.remove('hidden');
    else scheduleWrapEl.classList.add('hidden');
  }
}

async function onSavePost(e) {
  e.preventDefault();
  const id = Number(byId('editorDialog').dataset.editId || '') || null;
  const title = byId('post_title').value.trim();
  let slug = (byId('post_slug').value.trim() || slugify(title)).toLowerCase();
  const tags = []; // UI для тегов удалён
  const content = byId('post_content').value;
  const cover_url = (byId('post_cover_url')?.value || '').trim() || null;
  const description = (byId('post_description')?.value || '').trim().slice(0, 200) || null;
  let status = byId('post_status').value;
  const pinned = byId('post_pinned').checked;
  const scheduleEnabled = !!(toggleScheduleEl && toggleScheduleEl.checked);
  const scheduled_at = scheduleEnabled && byId('post_scheduled_at').value
    ? new Date(byId('post_scheduled_at').value).toISOString()
    : null;
  // normalize: if scheduling disabled but status==scheduled -> publish
  if (!scheduleEnabled && status === 'scheduled') status = 'published';

  if (!title) return alert('Заголовок обязателен');

  // ensure unique slug if creating
  if (!id) {
    const unique = await ensureUniqueSlug(slug);
    slug = unique;
  }

  // Guarantee published_at for published posts so they are visible publicly
  let published_at = null;
  if (status === 'published' && !scheduled_at) {
    published_at = new Date().toISOString();
  }
  const payload = { title, slug, tags, content, description, cover_url, status, pinned, scheduled_at, ...(published_at ? { published_at } : {}) };
  const q = id ? client.from('posts').update(payload).eq('id', id) : client.from('posts').insert(payload);
  const { error } = await q;
  if (error) return alert('Ошибка сохранения: ' + error.message);
  byId('editorDialog').close();
  await loadAdminPosts();
}

async function ensureUniqueSlug(base) {
  let candidate = base;
  let i = 1;
  while (true) {
    const { data } = await client.from('posts').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    i += 1; candidate = `${base}-${i}`;
    if (i > 1000) return `${base}-${Date.now()}`;
  }
}

async function onDeletePost() {
  const id = Number(byId('editorDialog').dataset.editId || '') || null;
  if (!id) return;
  const ok = await modalConfirm('Удалить пост навсегда?', 'Подтверждение удаления', 'Удалить', true);
  if (!ok) return;
  const { error } = await client.from('posts').delete().eq('id', id);
  if (error) return alert('Ошибка удаления: ' + error.message);
  byId('editorDialog').close();
  await loadAdminPosts();
}

// ===== Themed modal helpers =====
function modalConfirm(message, title = 'Подтверждение', okText = 'ОК', danger = false) {
  return new Promise((resolve) => {
    const dlg = byId('confirmDialog');
    if (!dlg) { resolve(confirm(message)); return; }
    byId('confirmTitle').textContent = title;
    byId('confirmMessage').textContent = message;
    // Set OK button text and style
    const form = dlg.querySelector('form');
    const okBtn = dlg.querySelector('.modal-actions .btn.danger, .modal-actions .btn.primary') || dlg.querySelector('.modal-actions button:last-child');
    if (okBtn) {
      okBtn.textContent = okText;
      okBtn.classList.toggle('danger', !!danger);
      okBtn.classList.toggle('primary', !danger);
      okBtn.setAttribute('value', 'ok');
    }
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue === 'ok');
    };
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    // Prevent actual submit navigation
    form?.addEventListener('submit', (e) => e.preventDefault(), { once: true });
  });
}

function modalPrompt(title = 'Ввод', placeholder = '') {
  return new Promise((resolve) => {
    const dlg = byId('promptDialog');
    if (!dlg) { const r = prompt(title); resolve(r || ''); return; }
    byId('promptTitle').textContent = title;
    const input = byId('promptInput');
    input.value = '';
    if (placeholder) input.placeholder = placeholder;
    const form = dlg.querySelector('form');
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue === 'ok' ? input.value.trim() : '');
    };
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    setTimeout(() => { input.focus(); }, 50);
    // Prevent full submit
    form?.addEventListener('submit', (e) => e.preventDefault(), { once: true });
  });
}

async function loadAdminPosts() {
  const search = byId('adminSearch').value.trim().toLowerCase();
  const status = byId('statusFilter').value;
  let q = client.from('posts').select('id, title, slug, description, status, pinned, published_at, scheduled_at, updated_at, tags').order('updated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) { console.error(error); return; }
  let items = data || [];

  // One-time backfill: set published_at for published posts missing it
  try {
    const missing = items.filter(p => p.status === 'published' && !p.published_at);
    if (missing.length) {
      await client.from('posts').update({ published_at: new Date().toISOString() }).in('id', missing.map(p => p.id));
      // reload to reflect changes
      const r2 = await (status ? client.from('posts').select('id, title, slug, description, status, pinned, published_at, scheduled_at, updated_at, tags').eq('status', status) : client.from('posts').select('id, title, slug, description, status, pinned, published_at, scheduled_at, updated_at, tags')).order('updated_at', { ascending: false });
      if (!r2.error) items = r2.data || items;
    }
  } catch (e) { console.warn('Backfill published_at failed', e); }

  if (search) items = items.filter(p =>
    p.title.toLowerCase().includes(search)
    || (p.description || '').toLowerCase().includes(search)
    || (p.tags||[]).join(',').toLowerCase().includes(search)
  );
  renderAdminPosts(items);
}

byId('statusFilter').addEventListener('change', loadAdminPosts);
byId('adminSearch').addEventListener('input', loadAdminPosts);

function renderAdminPosts(items) {
  const root = byId('adminPosts');
  root.innerHTML = '';
  
  // Заголовок таблицы
  const header = document.createElement('div');
  header.className = 'row';
  header.innerHTML = `
    <div class="cell">Заголовок</div>
    <div class="cell">Статус</div>
    <div class="cell">Дата</div>
    <div class="cell">Действия</div>
  `;
  root.appendChild(header);
  
  // Строки постов
  for (const p of items) {
    const row = document.createElement('div');
    row.className = 'row';
    
    // Определяем статус и его стиль
    let statusBadge = '';
    let statusClass = '';
    if (p.status === 'published') {
      statusBadge = '✅ Опубликован';
      statusClass = 'status-published';
    } else if (p.status === 'scheduled') {
      statusBadge = '⏰ Запланирован';
      statusClass = 'status-scheduled';
    } else {
      statusBadge = '📝 Черновик';
      statusClass = 'status-draft';
    }
    
    row.innerHTML = `
      <div class="cell">
        ${escapeHtml(p.title)}
        ${p.pinned ? ' <span style="color: var(--warning)">📌</span>' : ''}
      </div>
      <div class="cell">
        <span class="status-badge ${statusClass}">${statusBadge}</span>
      </div>
      <div class="cell">
        ${p.status==='published' ? formatDate(p.published_at) : 
          p.status==='scheduled' ? formatDate(p.scheduled_at) : 
          formatDate(p.updated_at)}
      </div>
      <div class="cell">
        <button class="btn small" data-edit="${p.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Редактировать
        </button>
      </div>
    `;
    
    row.querySelector('[data-edit]')?.addEventListener('click', async () => {
      const { data } = await client.from('posts').select('*').eq('id', p.id).maybeSingle();
      if (data) openEditor(data);
    });
    
    root.appendChild(row);
  }
  
  // Если нет постов
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'text-center text-muted';
    empty.style.padding = 'var(--gap-xl)';
    empty.innerHTML = `
      <div style="font-size: 48px; margin-bottom: var(--gap-md); opacity: 0.5;">📝</div>
      <div>Пока нет постов</div>
      <div style="font-size: 14px; margin-top: var(--gap-sm);">Создайте первый пост, нажав "Новый пост"</div>
    `;
    root.appendChild(empty);
  }
}

// -------------- Utilities
function formatDate(s) {
  if (!s) return '';
  try {
    const d = new Date(s);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

function toLocalInput(s) {
  const d = new Date(s);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]+/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\u0400-\u04FF\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// minimal markdown rendering (safe-ish): bold, italic, inline code, code blocks, paragraphs
function renderMarkdown(md) {
  // code blocks ```
  let html = md.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${escapeHtml(code)}</code></pre>`);
  // paragraphs
  html = html.split(/\n\s*\n/).map(p => `<p>${renderMarkdownInline(escapeHtml(p))}</p>`).join('');
  return html;
}
function renderMarkdownInline(t) {
  return t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// Smartish comment heuristics
function heuristics(body, name) {
  let score = 0;
  // length
  score += Math.min(3, body.length / 120);
  // links penalty
  const links = (body.match(/https?:\/\//g) || []).length; score -= links * 0.8;
  // shouting penalty
  if (/^[A-ZА-Я0-9\s\W]{20,}$/.test(body)) score -= 1.2;
  // bad words (very small demo set)
  const bad = /(лох|дурак|идиот|scam|crypto)/i.test(body); if (bad) score -= 1.5;
  // name bonus if looks human-ish
  if (/^[a-zа-я][a-zа-я0-9_\-\s]{2,}$/i.test(name)) score += 0.3;
  const flagged = score < -0.5 || links >= 3 || bad;
  return { score: Number(score.toFixed(2)), flagged };
}

function scoreComment(c) { return heuristics(c.body || '', c.author_name || '').score; }


// -------------- (obsolete handlers removed)

// -------------- Notifications (bell)
function initNotificationsUI() {
  updateNotifBadge();
}

async function loadNotifications() {
  if (!state.userIP) return;
  const { data, error } = await client
    .from('notifications')
    .select('*')
    .eq('user_ip', state.userIP)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.warn('notifications load:', error); return; }
  state.notifications = data || [];
  state.unreadNotifications = (state.notifications || []).filter(n => !n.read_at).length;
  renderNotifications();
  updateNotifBadge();
}

function renderNotifications() {
  const list = byId('notifList');
  const empty = byId('notifEmpty');
  if (!list) return;
  list.innerHTML = '';
  const items = state.notifications || [];
  if (!items.length) { if (empty) empty.hidden = false; return; }
  if (empty) empty.hidden = true;
  for (const n of items) {
    const el = document.createElement('div');
    el.className = `notif-item${n.read_at ? '' : ' unread'}`;
    const kind = escapeHtml(n.kind || 'info');
    const text = renderNotifText(n);
    el.innerHTML = `
      <div class="notif-kind">${kind}</div>
      <div class="notif-body">${text}</div>
      <div class="notif-time small muted">${formatDate(n.created_at)}</div>
    `;
    list.appendChild(el);
  }
}

function renderNotifText(n) {
  const p = n.payload || {};
  try { if (typeof p === 'string') { const j = JSON.parse(p); n.payload = j; } } catch {}
  const payload = n.payload || {};
  switch ((n.kind || '').toLowerCase()) {
    case 'ticket_admin_reply':
      return `Администратор ответил в тикете “${escapeHtml(payload.subject || '')}”`;
    case 'ticket_status_changed':
      return `Статус вашего тикета “${escapeHtml(payload.subject || '')}” изменён на ${escapeHtml(payload.status || '')}`;
    default:
      return escapeHtml(payload.message || 'Уведомление');
  }
}

function updateNotifBadge() {
  const b = byId('notifBadge');
  if (!b) return;
  const count = state.unreadNotifications || 0;
  b.textContent = String(count);
  b.hidden = count <= 0;
}

function toggleNotifPanel() {
  const panel = byId('notifPanel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
}

async function markAllNotificationsRead() {
  if (!state.userIP) return;
  const now = new Date().toISOString();
  const { error } = await client
    .from('notifications')
    .update({ read_at: now })
    .eq('user_ip', state.userIP)
    .is('read_at', null);
  if (error) { console.warn('notifications mark read:', error); return; }
  await loadNotifications();
}

function setupNotificationsRealtime() {
  try {
    if (state.notifSub) client.removeChannel(state.notifSub);
  } catch {}
  if (!state.userIP) return;
  state.notifSub = client
    .channel(`notifications_${state.userIP}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_ip=eq.${state.userIP}` }, () => {
      loadNotifications();
    })
    .subscribe();
}

// -------------- Support Tickets (user facing)
async function onSubmitTicket(e) {
  e.preventDefault();
  if (!state.userIP) { alert('Не удалось определить ваш IP'); return; }
  const subject = (byId('ticketSubject')?.value || '').trim();
  const priority = (byId('ticketPriority')?.value || 'normal');
  const body = (byId('ticketBody')?.value || '').trim();
  const creator_name = state.lockedName || 'Гость';
  if (!subject || !body) return;
  // Используем отдельный анонимный клиент, чтобы ответы обычных пользователей никогда не шли с админской сессией
  const base = window.__NVX_SUPA_BASE__ || { url: (window.SUPABASE_URL||''), key: (window.SUPABASE_ANON_KEY||'') };
  const anonClient = (typeof supabase !== 'undefined' && base.url && base.key)
    ? supabase.createClient(base.url, base.key, { auth: { persistSession: false } })
    : client;
  // 1) Создаём тикет
  const { data: tickets, error: e1 } = await anonClient
    .from('support_tickets')
    .insert({ subject, priority, creator_name, user_ip: state.userIP })
    .select('*')
    .limit(1);
  if (e1) { alert('Ошибка создания тикета: ' + e1.message); return; }
  const ticket = (tickets || [])[0];
  // 2) Создаём первое сообщение
  const { error: e2 } = await anonClient
    .from('support_messages')
    .insert({ ticket_id: ticket.id, author_role: 'user', author_name: creator_name, body });
  if (e2) { alert('Ошибка отправки сообщения: ' + e2.message); return; }
  byId('ticketSubject').value = '';
  byId('ticketBody').value = '';
  await loadMyTickets();
}

async function loadMyTickets() {
  if (!state.userIP) return;
  const empty = byId('myTicketsEmpty');
  const { data: tickets, error } = await client
    .from('support_tickets')
    .select('*')
    .eq('user_ip', state.userIP)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) { console.warn('loadMyTickets:', error); return; }
  state.myTickets = tickets || [];
  if (!state.myTickets.length) { if (empty) empty.hidden = false; return; } else if (empty) empty.hidden = true;
  // Load messages in bulk
  const ids = state.myTickets.map(t => t.id);
  const { data: msgs, error: e2 } = await client
    .from('support_messages')
    .select('*')
    .in('ticket_id', ids)
    .order('created_at', { ascending: true });
  if (e2) { console.warn('loadMyTickets msgs:', e2); }
  state.ticketMessages.clear();
  (msgs || []).forEach(m => {
    const arr = state.ticketMessages.get(m.ticket_id) || [];
    arr.push(m);
    state.ticketMessages.set(m.ticket_id, arr);
  });
  renderMyTickets();
  setTimeout(updateProfileTabCounts, 0);
}

function renderMyTickets() {
  // Рендерим список слева (или выше) и детали выбранного тикета ниже
  const list = byId('myTicketsList');
  const empty = byId('myTicketsEmpty');
  const detail = byId('myTicketDetail');
  if (list) list.innerHTML = '';

  const items = state.myTickets || [];
  if (!items.length) {
    if (empty) empty.hidden = false;
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
    return;
  } else if (empty) empty.hidden = true;

  // Список: «Тикет №001 — Тема», кликабельно
  const ul = document.createElement('div');
  ul.className = 'tickets-list';
  items.forEach((t, idx) => {
    const num = String(idx + 1).padStart(3, '0');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ticket-row';
    row.dataset.ticketId = String(t.id);
    row.innerHTML = `
      <div class="row between align-center" style="width:100%">
        <div class="row align-center gap-sm">
          <span class="badge small">№${num}</span>
          <span class="ellipsis">${escapeHtml(t.subject || 'Без темы')}</span>
        </div>
        <div class="row align-center gap-sm small muted">
          <span>${t.status === 'open' ? 'Открыт' : 'Закрыт'}</span>
          <span>·</span>
          <span>${formatDate(t.updated_at || t.created_at)}</span>
        </div>
      </div>
    `;
    ul.appendChild(row);
  });
  if (list) list.appendChild(ul);

  // Event delegation to guard against re-renders
  if (list && !list.dataset.clickBound) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.ticket-row');
      if (!btn) return;
      const id = btn.dataset.ticketId;
      if (id) openMyTicket(id);
    });
    list.dataset.clickBound = '1';
  }

  // Никогда не авто-открываем при рендере, чтобы избежать двойного открытия
  if (detail) {
    detail.hidden = true;
    detail.innerHTML = '';
  }
}

function openMyTicket(ticketId) {
  console.debug('[tickets] click on ticket', ticketId);
  state.activeTicketId = ticketId;
  const dialog = byId('ticketDialog');
  const bodyEl = byId('ticketDetailBody');
  const titleEl = byId('ticketDialogTitle');
  // If modal dialog not found, fallback to inline detail container
  const inlineDetail = byId('myTicketDetail');
  const useInline = !dialog || !bodyEl;
  const t = (state.myTickets || []).find(x => String(x.id) === String(ticketId));
  if (!t) { if (!useInline) dialog.close?.(); if (inlineDetail) { inlineDetail.hidden = true; inlineDetail.innerHTML = ''; } return; }

  // Переходим на отдельную страницу тикета в той же вкладке
  try {
    window.location.href = `ticket.html?id=${encodeURIComponent(t.id)}`;
    return;
  } catch (_) { /* если что-то пойдёт не так — ниже есть локальный fallback */ }

  // Открываем внутри текущей страницы: модалка (или inline fallback ниже)

  // Подсветка активного в списке
  $$('.ticket-row')?.forEach(btn => btn.classList.toggle('active', String(btn.dataset.ticketId) === String(ticketId)));

  const priIcon = t.priority === 'high' ? '🔥' : t.priority === 'low' ? '🟢' : '🟠';
  const threadHtml = renderTicketThread(t.id);
  const canReply = t.status === 'open';
  const num = String((state.myTickets || []).findIndex(x => String(x.id) === String(t.id)) + 1).padStart(3, '0');
  const detailHtml = `
    <div class="comment">
      <div class="comment-header">
        <div class="comment-author">
          <div class="avatar">T</div>
          <span class="comment-author-name">Тикет №${num} — ${escapeHtml(t.subject || '')}</span>
          <span class="admin-label" title="Приоритет">${priIcon}</span>
        </div>
        <div class="comment-meta small text-muted">${t.status === 'open' ? 'Открыт' : 'Закрыт'} · ${formatDate(t.updated_at || t.created_at)}</div>
      </div>
      <div class="comment-body">
        ${threadHtml}
      </div>
      <div class="comment-actions">
        ${canReply ? `
          <div class="row gap-sm" style="width:100%">
            <input type="text" id="ticketReply_${t.id}" placeholder="Ваш ответ…" style="flex:1" />
            <button class="comment-action" data-reply-ticket="${t.id}">Ответить</button>
          </div>
        ` : '<span class="muted">Тикет закрыт</span>'}
      </div>
    </div>
  `;
  if (useInline && inlineDetail) {
    console.debug('[tickets] using inline fallback (no dialog)');
    inlineDetail.innerHTML = detailHtml;
    inlineDetail.hidden = false;
    inlineDetail.querySelector('[data-reply-ticket]')?.addEventListener('click', () => onTicketReply(t.id));
    return;
  }

  if (titleEl) titleEl.textContent = `Тикет №${num} — ${t.subject || ''}`;
  bodyEl.innerHTML = detailHtml;
  // open modal with fallbacks and error handling
  try {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
      dialog.style.display = 'block';
    }
  } catch (err) {
    console.warn('ticketDialog showModal failed, fallback to open attr:', err);
    dialog.setAttribute('open', '');
    dialog.style.display = 'block';
  }
  bodyEl.querySelector('[data-reply-ticket]')?.addEventListener('click', () => onTicketReply(t.id));

  // After a frame, check visibility; if hidden, fallback to inline
  setTimeout(() => {
    try {
      const rect = dialog.getBoundingClientRect();
      const visible = dialog.hasAttribute('open') && rect.width > 10 && rect.height > 10;
      if (!visible && inlineDetail) {
        console.warn('[tickets] dialog appears hidden by CSS, rendering inline fallback');
        inlineDetail.innerHTML = detailHtml;
        inlineDetail.hidden = false;
        inlineDetail.querySelector('[data-reply-ticket]')?.addEventListener('click', () => onTicketReply(t.id));
      }
    } catch (e) { /* noop */ }
  }, 0);
}

function renderTicketThread(ticketId) {
  const msgs = state.ticketMessages.get(ticketId) || [];
  if (!msgs.length) return '<div class="muted">Нет сообщений</div>';
  return msgs.map(m => {
    const admin = m.author_role === 'admin';
    const name = admin ? 'сайт' : escapeHtml(m.author_name || 'Гость');
    return `
      <div class="comment ${admin ? 'comment-admin' : ''}">
        <div class="comment-header">
          <div class="comment-author">
            <div class="avatar">${admin ? 'S' : (name[0]||'?').toUpperCase()}</div>
            <span class="comment-author-name">${escapeHtml(name)}</span>
            ${admin ? '<span class="admin-label" title="Администратор">АДМИН</span>' : ''}
          </div>
          <span class="comment-time">${formatDate(m.created_at)}</span>
        </div>
        <div class="comment-body">${renderMarkdownInline(escapeHtml(m.body || ''))}</div>
      </div>
    `;
  }).join('');
}

async function onTicketReply(ticketId) {
  const input = byId(`ticketReply_${ticketId}`);
  const text = (input?.value || '').trim();
  if (!text) return;
  const author_name = state.lockedName || 'Гость';
  // Ответ пользователя — строго через анонимный клиент без сохранения сессии
  const base = window.__NVX_SUPA_BASE__ || { url: (window.SUPABASE_URL||''), key: (window.SUPABASE_ANON_KEY||'') };
  const anonClient = (typeof supabase !== 'undefined' && base.url && base.key)
    ? supabase.createClient(base.url, base.key, { auth: { persistSession: false } })
    : client;
  const { error } = await anonClient
    .from('support_messages')
    .insert({ ticket_id: ticketId, author_role: 'user', author_name, body: text });
  if (error) { alert('Ошибка ответа: ' + error.message); return; }
  if (input) input.value = '';
  await loadMyTickets();
}

// ---- Admin: Tickets
async function loadAdminTickets() {
  const list = byId('adminTicketsList');
  if (!state.isAdmin || !list) return;
  list.innerHTML = '<div class="loading-text">Загрузка тикетов...</div>';

  const status = byId('adminTicketStatus')?.value || 'open';
  const sort = byId('adminTicketSort')?.value || 'recent';
  try {
    let q = client.from('support_tickets').select('*');
    if (status !== 'all') q = q.eq('status', status);
    const orderCol = sort === 'updated' ? 'updated_at' : 'created_at';
    const { data, error } = await q.order(orderCol, { ascending: false }).limit(200);
    if (error) { list.innerHTML = `<div class="muted">Ошибка загрузки: ${escapeHtml(error.message)}</div>`; return; }
    renderAdminTicketsList(data || []);
  } catch (e) {
    list.innerHTML = `<div class="muted">Ошибка: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderAdminTicketsList(items) {
  const root = byId('adminTicketsList');
  if (!root) return;
  root.innerHTML = '';
  if (!items?.length) {
    root.innerHTML = '<div class="muted">Тикетов нет по выбранным фильтрам.</div>';
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'tickets-list';
  items.forEach((t, idx) => {
    const num = String(idx + 1).padStart(3, '0');
    const row = document.createElement('div');
    row.className = 'ticket-row admin-ticket-row';
    row.dataset.ticketId = String(t.id);
    row.innerHTML = `
      <div class="row between align-center" style="width:100%">
        <div class="row align-center gap-sm">
          <span class="badge small">№${num}</span>
          <span class="ellipsis">${escapeHtml(t.subject || 'Без темы')}</span>
          <span class="pill ${t.status === 'open' ? 'ok' : 'muted'}" title="Статус">${t.status === 'open' ? 'Открыт' : 'Закрыт'}</span>
        </div>
        <div class="row align-center gap-sm small muted">
          <span title="Автор">${escapeHtml(t.creator_name || 'Гость')}</span>
          <span>·</span>
          <span title="IP">${escapeHtml(t.user_ip || '—')}</span>
          <span>·</span>
          <span title="Обновлён">${formatDate(t.updated_at || t.created_at)}</span>
          <button class="btn ghost" data-open>Открыть</button>
          <button class="btn ghost" data-toggle>${t.status === 'open' ? 'Закрыть' : 'Открыть'}</button>
        </div>
      </div>
    `;
    wrap.appendChild(row);
  });
  root.appendChild(wrap);

  if (!root.dataset.clickBound) {
    root.addEventListener('click', async (e) => {
      const row = e.target.closest('.admin-ticket-row');
      if (!row) return;
      const id = row.dataset.ticketId;
      if (!id) return;
      if (e.target.matches('[data-open]')) {
        // Открыть в этой вкладке отдельную страницу тикета (админ-контекст)
        location.href = `ticket.html?id=${encodeURIComponent(id)}&admin=1`;
        return;
      }
      if (e.target.matches('[data-toggle]')) {
        const statusEl = row.querySelector('[data-toggle]');
        const next = statusEl?.textContent?.includes('Открыть') ? 'open' : 'closed';
        try {
          const { error } = await client.from('support_tickets').update({ status: next }).eq('id', id);
          if (error) return alert('Не удалось изменить статус: ' + error.message);
          await loadAdminTickets();
        } catch (err) { alert('Ошибка: ' + (err.message || err)); }
        return;
      }
      // Клик по строке — тоже открыть (админ-контекст)
      if (e.target.closest('.row')) {
        location.href = `ticket.html?id=${encodeURIComponent(id)}&admin=1`;
      }
    });
    root.dataset.clickBound = '1';
  }
}

// -------------- Footer year
byId('year').textContent = String(new Date().getFullYear());
