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
  lockedName: null      // Закреплённый ник для этого IP (если есть)
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
  fetchUserIP().then(checkAndLockName).catch(() => {});
  
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
  } else if (r.page === 'admin') {
    showRoute('admin');
    await ensureAuthUI();
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
  // 1) Пытаемся войти
  let { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error && /invalid login credentials/i.test(error.message)) {
    // 2) Если нет пользователя — создаём и пробуем войти повторно
    const su = await client.auth.signUp({ email, password });
    if (su.error) return alert('Регистрация не удалась: ' + su.error.message);
    if (!su.data?.user) {
      return alert('Проверьте почту и подтвердите адрес, затем войдите ещё раз.');
    }
    // повторная попытка входа
    ({ data, error } = await client.auth.signInWithPassword({ email, password }));
    if (error) return alert('Вход после регистрации не удался: ' + error.message);
  } else if (error) {
    return alert('Ошибка входа: ' + error.message);
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
    alert('У вас нет прав администратора. Обратитесь к владельцу или назначьте роль admin.');
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

// -------------- Footer year
byId('year').textContent = String(new Date().getFullYear());

// -------------- Startup
document.addEventListener('DOMContentLoaded', () => {
  onRoute();
  getSession().then(async (s) => {
    const r = parseHash();
    if (r.page === 'home') await loadHome();
  });
});
