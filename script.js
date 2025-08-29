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

function renderAdminPostsPagination(totalPages) {
  const wrap = byId('adminPostsPagination');
  const prev = byId('adminPrevPostPage');
  const next = byId('adminNextPostPage');
  const nums = byId('adminPostPageNumbers');
  if (!wrap || !prev || !next || !nums) return;
  if (state.totalAdminPosts <= state.adminPostsPerPage) { wrap.hidden = true; return; }
  wrap.hidden = false;
  prev.disabled = state.adminPostsPage === 1;
  const last = Math.max(1, Math.ceil(state.totalAdminPosts / state.adminPostsPerPage));
  next.disabled = state.adminPostsPage === last;
  nums.innerHTML = '';
  const maxVisible = 5;
  let start = Math.max(1, state.adminPostsPage - Math.floor(maxVisible/2));
  let end = Math.min(last, start + maxVisible - 1);
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
  const addNum = (n) => {
    const b = document.createElement('button');
    b.className = `page-number ${n === state.adminPostsPage ? 'active' : ''}`;
    b.textContent = String(n);
    b.onclick = () => loadAdminPosts(n);
    nums.appendChild(b);
  };
  const addEll = () => { const s = document.createElement('span'); s.className = 'page-ellipsis'; s.textContent = '...'; nums.appendChild(s); };
  if (start > 1) { addNum(1); if (start > 2) addEll(); }
  for (let i = start; i <= end; i++) addNum(i);
  if (end < last) { if (end < last - 1) addEll(); addNum(last); }
  if (!wrap.dataset.bound) {
    prev.addEventListener('click', () => loadAdminPosts(Math.max(1, state.adminPostsPage - 1)));
    next.addEventListener('click', () => loadAdminPosts(Math.min(last, state.adminPostsPage + 1)));
    wrap.dataset.bound = '1';
  }
}

function renderAdminCommentsPagination(totalPages) {
  const wrap = byId('adminCommentsPagination');
  const prev = byId('adminPrevCommentPage');
  const next = byId('adminNextCommentPage');
  const nums = byId('adminCommentPageNumbers');
  if (!wrap || !prev || !next || !nums) return;
  if (state.totalAdminComments <= state.adminCommentsPerPage) { wrap.hidden = true; return; }
  wrap.hidden = false;
  prev.disabled = state.adminCommentsPage === 1;
  const last = Math.max(1, Math.ceil(state.totalAdminComments / state.adminCommentsPerPage));
  next.disabled = state.adminCommentsPage === last;
  nums.innerHTML = '';
  const maxVisible = 5;
  let start = Math.max(1, state.adminCommentsPage - Math.floor(maxVisible/2));
  let end = Math.min(last, start + maxVisible - 1);
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
  const addNum = (n) => {
    const b = document.createElement('button');
    b.className = `page-number ${n === state.adminCommentsPage ? 'active' : ''}`;
    b.textContent = String(n);
    b.onclick = () => loadAdminComments(n);
    nums.appendChild(b);
  };
  const addEll = () => { const s = document.createElement('span'); s.className = 'page-ellipsis'; s.textContent = '...'; nums.appendChild(s); };
  if (start > 1) { addNum(1); if (start > 2) addEll(); }
  for (let i = start; i <= end; i++) addNum(i);
  if (end < last) { if (end < last - 1) addEll(); addNum(last); }
  // bind prev/next once
  if (!wrap.dataset.bound) {
    prev.addEventListener('click', () => loadAdminComments(Math.max(1, state.adminCommentsPage - 1)));
    next.addEventListener('click', () => loadAdminComments(Math.min(last, state.adminCommentsPage + 1)));
    wrap.dataset.bound = '1';
  }
}

// -------------- Ticket SPA page
async function loadTicketSPA(ticketId) {
  // Если id не передали — попробуем взять из последнего открытого
  if (!ticketId) {
    try { const last = localStorage.getItem('nvx_last_ticket_id'); if (last) ticketId = last; } catch(_) {}
  }
  try {
    // Обновим admin-флаг на всякий случай (если открыто не из админки)
    const session = await getSession();
    state.isAdmin = await checkIsAdmin(session?.user?.id);
  } catch(_) {}
  // Доп. подсказки: если открывали из админки или есть локальный флаг — считаем, что пользователь намерен отвечать как админ.
  const lsAdmin = (localStorage.getItem('nvx_is_admin') === '1');
  const titleEl = byId('tTitle');
  const metaEl = byId('tMeta');
  const threadEl = byId('tThread');
  const emptyEl = byId('tEmpty');
  const replyWrap = byId('tReply');
  if (threadEl) threadEl.innerHTML = '';
  if (titleEl) titleEl.textContent = 'Тикет';
  if (metaEl) metaEl.textContent = 'Загрузка…';

  if (!ticketId) { if (titleEl) titleEl.textContent = 'Тикет не указан'; if (metaEl) metaEl.textContent = '—'; return; }
  let { data: t, error } = await client.from('support_tickets').select('*').eq('id', ticketId).maybeSingle();
  if (error || !t) {
    // Пытаемся взять из кэша
    try {
      const cachedMeta = localStorage.getItem(`nvx_ticket_meta_${ticketId}`);
      if (cachedMeta) {
        t = JSON.parse(cachedMeta);
        error = null;
      }
    } catch (_) {}
  }
  if (error || !t) { if (titleEl) titleEl.textContent = 'Ошибка загрузки'; if (metaEl) metaEl.textContent = error?.message || 'Данных нет'; return; }

  // Устанавливаем заголовок
  if (titleEl) titleEl.textContent = `Тикет #${String(t.id).slice(0,8)} — ${t.subject || ''}`;
  if (metaEl) metaEl.textContent = `${t.status === 'open' ? 'Открыт' : 'Закрыт'} · обновлён ${formatDate(t.updated_at || t.created_at)}`;
  try { localStorage.setItem('nvx_last_ticket_id', String(t.id)); } catch(_) {}

  // Загрузим ник по IP для отображения
  let ticketUserName = null;
  try {
    if (t.user_ip) {
      const { data: ipn } = await client.from('ip_names').select('author_name').eq('ip', t.user_ip).maybeSingle();
      ticketUserName = ipn?.author_name || null;
    }
  } catch(_) {}

  const { data: msgs, error: e2 } = await client
    .from('support_messages')
    .select('*')
    .eq('ticket_id', t.id)
    .order('created_at', { ascending: true });
  if (e2) console.warn('loadTicketSPA msgs:', e2);
  let list = msgs || [];
  // Если сообщений нет — попробуем достать из кэша (независимо от контекста)
  if (!list.length) {
    try {
      const cached = localStorage.getItem(`nvx_ticket_msgs_${t.id}`);
      if (cached) list = JSON.parse(cached);
    } catch(_) {}
  }
  if (emptyEl) emptyEl.hidden = !!list.length;
  if (threadEl) {
    threadEl.innerHTML = list.map(m => {
      const admin = m.author_role === 'admin';
      const name = admin ? 'nevrqx admin' : (m.author_name || ticketUserName || t.creator_name || 'посетитель');
      return `
        <div class="comment ${admin ? 'comment-admin' : ''}">
          <div class="comment-header">
            <div class="comment-author">
              <div class="avatar">${admin ? 'A' : (name[0]||'?').toUpperCase()}</div>
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

  // Кнопка ответа
  if (replyWrap) {
    if (t.status !== 'open') { replyWrap.hidden = true; }
    else {
      replyWrap.hidden = false;
      const btn = byId('replyBtn');
      const input = byId('replyInput');
      if (btn) {
        btn.onclick = async () => {
          const text = (input?.value || '').trim();
          if (!text) return;
          // Определяем режим: админ или пользователь
          let asAdmin = !!state.isAdmin || !!state.ticketAdminHint || lsAdmin;
          // Переуточним по реальной сессии (если есть), но не блокируем отправку — серверная логика всё равно выставит корректную роль
          try { const s = await getSession(); asAdmin = asAdmin || await checkIsAdmin(s?.user?.id); } catch(_) {}
          btn.disabled = true;
          // Пользователь — через анонимный клиент без сохранения сессии
          const base = window.__NVX_SUPA_BASE__ || { url: (window.SUPABASE_URL||''), key: (window.SUPABASE_ANON_KEY||'') };
          const anonClient = (typeof supabase !== 'undefined' && base.url && base.key)
            ? supabase.createClient(base.url, base.key, { auth: { persistSession: false } })
            : client;
          const payload = {
            ticket_id: t.id,
            body: text,
            author_role: asAdmin ? 'admin' : 'user',
            author_name: asAdmin ? 'nevrqx admin' : (state.lockedName || ticketUserName || t.creator_name || 'посетитель'),
          };
          const clientToUse = asAdmin ? client : anonClient;
          const { error: se } = await clientToUse.from('support_messages').insert(payload);
          btn.disabled = false;
          if (se) { alert('Ошибка отправки: ' + (se?.message || 'неизвестная ошибка')); return; }
          if (input) input.value = '';
          await loadTicketSPA(ticketId);
        };
      }
    }
  }

  // Обновим кэш (чтобы при открытии без сессии было что показать)
  try {
    localStorage.setItem(`nvx_ticket_meta_${t.id}` , JSON.stringify({ id: t.id, subject: t.subject, status: t.status, updated_at: t.updated_at, created_at: t.created_at, user_ip: t.user_ip, creator_name: t.creator_name }));
    if (Array.isArray(list) && list.length) localStorage.setItem(`nvx_ticket_msgs_${t.id}`, JSON.stringify(list));
  } catch(_) {}
}

// -------------- Profile Tabs
function initProfileTabs() {
  $$('.profile-tabs [data-profile-tab]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveProfileTab(btn.dataset.profileTab);
    });
  });
}

// ===== Admin Settings: Dangerous actions =====
function bindAdminSettingsDanger() {
  const root = byId('adminSectionSettings');
  if (!root || root.dataset.bound) return;
  root.dataset.bound = '1';
  const btnClearComments = byId('btnClearComments');
  const btnClearTickets = byId('btnClearTickets');
  const btnClearIpNames = byId('btnClearIpNames');
  const btnClearAll = byId('btnClearAll');
  btnClearComments?.addEventListener('click', onClearAllComments);
  btnClearTickets?.addEventListener('click', onClearAllTickets);
  btnClearIpNames?.addEventListener('click', onClearAllIpNames);
  btnClearAll?.addEventListener('click', onClearAllDangerous);
}

function setSettingsStatus(text, isError = false) {
  const el = byId('adminSettingsStatus');
  if (!el) return;
  el.textContent = text;
  el.removeAttribute('hidden');
  el.classList.toggle('error', !!isError);
}

async function uiTick(ms = 60) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureAdminOrWarn() {
  if (!state.isAdmin) {
    setSettingsStatus('Доступ запрещён: только администратор может выполнять это действие.', true);
    return false;
  }
  return true;
}

async function onClearAllComments() {
  if (!(await ensureAdminOrWarn())) return;
  const ok = await showDangerConfirmDialog(
    '💬 Удаление комментариев',
    'Удалить ВСЕ комментарии на сайте безвозвратно?',
    'Это действие удалит все комментарии пользователей и не может быть отменено.',
    'Удалить комментарии'
  );
  if (!ok) return;
  setSettingsStatus('🗑️ Удаление комментариев...');
  await uiTick();
  const { error } = await client.from('comments').delete().not('id', 'is', null);
  if (error) { setSettingsStatus('❌ Ошибка: ' + error.message, true); return; }
  setSettingsStatus('✅ Все комментарии удалены.');
  await uiTick();
  // Обновим текущие представления
  try {
    const r = parseHash();
    if (r.page === 'post' && state.currentPost) await loadComments(state.currentPost.id);
    if (state.activeAdminTab === 'comments') await loadAdminComments();
  } catch(_) {}
}

async function onClearAllTickets() {
  if (!(await ensureAdminOrWarn())) return;
  const ok = await showDangerConfirmDialog(
    '🎫 Удаление тикетов',
    'Удалить ВСЕ тикеты поддержки и сообщения?',
    'Будут удалены все тикеты пользователей и переписка с поддержкой. Это действие необратимо.',
    'Удалить тикеты'
  );
  if (!ok) return;
  setSettingsStatus('📋 Удаление сообщений тикетов...');
  await uiTick();
  const delMsgs = await client.from('support_messages').delete().not('id', 'is', null);
  if (delMsgs.error) { setSettingsStatus('❌ Ошибка удаления сообщений: ' + delMsgs.error.message, true); return; }
  setSettingsStatus('🎫 Удаление тикетов...');
  await uiTick();
  const delT = await client.from('support_tickets').delete().not('id', 'is', null);
  if (delT.error) { setSettingsStatus('❌ Ошибка удаления тикетов: ' + delT.error.message, true); return; }
  setSettingsStatus('✅ Все тикеты и сообщения удалены.');
  await uiTick();
  try {
    if (state.activeAdminTab === 'tickets') await loadAdminTickets(1);
    if (byId('myTicketsList')) await loadMyTickets(1);
  } catch(_) {}
}

async function onClearAllIpNames() {
  if (!(await ensureAdminOrWarn())) return;
  const ok = await showDangerConfirmDialog(
    '👤 Сброс никнеймов',
    'Сбросить все закреплённые никнеймы пользователей?',
    'Все пользователи потеряют свои закреплённые имена и получат новые автоматически сгенерированные.',
    'Сбросить никнеймы'
  );
  if (!ok) return;
  setSettingsStatus('👤 Сброс закреплённых ников...');
  await uiTick();
  const { error } = await client.from('ip_names').delete().not('ip', 'is', null);
  if (error) { setSettingsStatus('❌ Ошибка: ' + error.message, true); return; }
  setSettingsStatus('✅ Таблица закреплённых ников очищена.');
  await uiTick();
  try { await checkAndLockName(); } catch(_) {}
}

async function onClearAllDangerous() {
  if (!(await ensureAdminOrWarn())) return;
  
  // Единое модальное окно с детальным подтверждением
  const confirmed = await showMegaConfirmDialog();
  if (!confirmed) return;
  
  setSettingsStatus('🔥 Выполняется полная очистка данных...');
  await uiTick();
  
  try {
    // Выполняем все операции последовательно без дополнительных подтверждений
    setSettingsStatus('🗑️ Удаление всех комментариев...');
    await uiTick();
    const { error: e1 } = await client.from('comments').delete().not('id', 'is', null);
    if (e1) throw new Error('Комментарии: ' + e1.message);
    
    setSettingsStatus('📋 Удаление сообщений тикетов...');
    await uiTick();
    const { error: e2 } = await client.from('support_messages').delete().not('id', 'is', null);
    if (e2) throw new Error('Сообщения тикетов: ' + e2.message);
    
    setSettingsStatus('🎫 Удаление тикетов...');
    await uiTick();
    const { error: e3 } = await client.from('support_tickets').delete().not('id', 'is', null);
    if (e3) throw new Error('Тикеты: ' + e3.message);
    
    setSettingsStatus('👤 Сброс закреплённых ников...');
    await uiTick();
    const { error: e4 } = await client.from('ip_names').delete().not('ip', 'is', null);
    if (e4) throw new Error('IP имена: ' + e4.message);
    
    setSettingsStatus('✅ Полная очистка успешно завершена!');
    await uiTick();
    
    // Обновляем все представления
    try {
      const r = parseHash();
      if (r.page === 'post' && state.currentPost) await loadComments(state.currentPost.id);
      if (state.activeAdminTab === 'comments') await loadAdminComments();
      if (state.activeAdminTab === 'tickets') await loadAdminTickets(1);
      if (byId('myTicketsList')) await loadMyTickets(1);
      await checkAndLockName();
    } catch(_) {}
    
  } catch (e) {
    setSettingsStatus('❌ Ошибка при полной очистке: ' + (e?.message || String(e)), true);
  }
}

// Специальное модальное окно для мега-действия
async function showMegaConfirmDialog() {
  return new Promise((resolve) => {
    // Создаем кастомный диалог
    const dialog = document.createElement('dialog');
    dialog.className = 'modal mega-confirm-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="modal-card" style="max-width: 500px;">
        <div class="modal-header" style="background: linear-gradient(135deg, var(--danger), #dc2626); color: white;">
          <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">
            ⚠️ КРИТИЧЕСКОЕ ПРЕДУПРЕЖДЕНИЕ
          </h3>
        </div>
        <div class="modal-body" style="padding: 24px;">
          <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <h4 style="color: var(--danger); margin: 0 0 12px 0;">Будут БЕЗВОЗВРАТНО удалены:</h4>
            <ul style="margin: 0; padding-left: 20px; color: var(--text-secondary);">
              <li>🗑️ Все комментарии на сайте</li>
              <li>📋 Все тикеты поддержки и сообщения</li>
              <li>👤 Все закреплённые никнеймы пользователей</li>
            </ul>
          </div>
          <p style="margin: 0 0 16px 0; font-weight: 500;">
            Это действие <strong style="color: var(--danger);">НЕОБРАТИМО</strong> и затронет реальную базу данных Supabase.
          </p>
          <p style="margin: 0; color: var(--text-muted); font-size: 14px;">
            Для подтверждения введите: <code style="background: var(--bg-card); padding: 2px 6px; border-radius: 4px; color: var(--danger); font-weight: bold;">УДАЛИТЬ ВСЁ</code>
          </p>
          <input type="text" id="megaConfirmInput" placeholder="Введите текст подтверждения..." 
                 style="margin-top: 12px; width: 100%; padding: 12px; border: 2px solid var(--border); border-radius: 8px; background: var(--bg-card); color: var(--text);">
        </div>
        <div class="modal-actions" style="padding: 16px 24px; border-top: 1px solid var(--border);">
          <button type="button" class="btn ghost" id="megaCancelBtn">Отмена</button>
          <button type="button" class="btn danger" id="megaConfirmBtn" disabled>
            🔥 ВЫПОЛНИТЬ ОЧИСТКУ
          </button>
        </div>
      </form>
    `;
    
    document.body.appendChild(dialog);
    
    const input = dialog.querySelector('#megaConfirmInput');
    const confirmBtn = dialog.querySelector('#megaConfirmBtn');
    const cancelBtn = dialog.querySelector('#megaCancelBtn');
    
    // Проверка ввода
    input.addEventListener('input', () => {
      const isValid = input.value.trim() === 'УДАЛИТЬ ВСЁ';
      confirmBtn.disabled = !isValid;
      confirmBtn.style.opacity = isValid ? '1' : '0.5';
    });
    
    // Обработчики
    confirmBtn.addEventListener('click', () => {
      dialog.close('confirmed');
    });
    
    cancelBtn.addEventListener('click', () => {
      dialog.close('cancelled');
    });
    
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'confirmed';
      document.body.removeChild(dialog);
      resolve(result);
    });
    
    dialog.showModal();
    setTimeout(() => input.focus(), 100);
  });
}

// Красивый диалог подтверждения для опасных действий
async function showDangerConfirmDialog(title, message, description, confirmText) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.innerHTML = `
      <form method="dialog" class="modal-card danger-confirm">
        <div class="modal-header">
          <h3>${title}</h3>
          <button type="button" class="btn ghost" value="cancel" style="padding: 8px; min-width: auto;">✕</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom: 16px;">
            <p style="font-size: 16px; font-weight: 500; color: var(--text); margin-bottom: 8px;">
              ${message}
            </p>
            <p style="color: var(--text-muted); font-size: 14px; line-height: 1.5;">
              ${description}
            </p>
          </div>
          <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 12px;">
            <p style="margin: 0; color: #fca5a5; font-size: 13px; font-weight: 500;">
              ⚠️ Это действие необратимо и затронет реальную базу данных
            </p>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" value="cancel">Отмена</button>
          <button type="button" class="btn danger" value="confirm">${confirmText}</button>
        </div>
      </form>
    `;
    
    document.body.appendChild(dialog);
    
    const cancelBtns = dialog.querySelectorAll('[value="cancel"]');
    const confirmBtn = dialog.querySelector('[value="confirm"]');
    
    cancelBtns.forEach(btn => {
      btn.addEventListener('click', () => dialog.close('cancel'));
    });
    
    confirmBtn.addEventListener('click', () => dialog.close('confirm'));
    
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'confirm';
      document.body.removeChild(dialog);
      resolve(result);
    });
    
    dialog.showModal();
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
    account: byId('profileSectionAccount'),
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
  if (name === 'account') initAccountSection();
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

// Skeleton loader generators
function createTicketSkeleton() {
  return `
    <div class="skeleton-comment">
      <div class="comment-header">
        <div class="comment-author">
          <div class="skeleton skeleton-avatar"></div>
          <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="skeleton skeleton-text" style="width: 80px;"></div>
      </div>
      <div class="skeleton skeleton-text long"></div>
      <div class="skeleton skeleton-text medium"></div>
    </div>
    <div class="skeleton-comment">
      <div class="comment-header">
        <div class="comment-author">
          <div class="skeleton skeleton-avatar"></div>
          <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="skeleton skeleton-text" style="width: 80px;"></div>
      </div>
      <div class="skeleton skeleton-text long"></div>
    </div>
  `;
}

function createPostsSkeleton(count = 3) {
  let html = '<div class="posts-skeleton">';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-post">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text long"></div>
        <div class="skeleton skeleton-text medium"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

function createCommentsSkeleton(count = 4) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-comment">
        <div class="comment-header">
          <div class="comment-author">
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton skeleton-text short"></div>
          </div>
          <div class="skeleton skeleton-text" style="width: 80px;"></div>
        </div>
        <div class="skeleton skeleton-text long"></div>
        <div class="skeleton skeleton-text medium"></div>
      </div>
    `;
  }
  return html;
}

function createTicketsSkeleton(count = 5) {
  let html = '<div class="tickets-skeleton">';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-ticket">
        <div class="row between align-center">
          <div class="skeleton skeleton-text medium"></div>
          <div class="skeleton skeleton-text" style="width: 60px;"></div>
        </div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

function createAdminSkeleton(count = 6) {
  let html = '<div class="admin-skeleton">';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="admin-skeleton-row">
        <div class="skeleton admin-skeleton-cell"></div>
        <div class="skeleton admin-skeleton-cell"></div>
        <div class="skeleton admin-skeleton-cell"></div>
        <div class="skeleton admin-skeleton-cell"></div>
        <div class="skeleton admin-skeleton-cell"></div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

function createNotificationsSkeleton(count = 4) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-notification">
        <div class="skeleton skeleton-text" style="width: 60px; height: 20px; margin-bottom: 8px;"></div>
        <div class="skeleton skeleton-text long"></div>
        <div class="skeleton skeleton-text" style="width: 100px; height: 14px; margin-top: 8px;"></div>
      </div>
    `;
  }
  return html;
}

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
  currentPage: 1,
  postsPerPage: 9,
  totalPosts: 0,
  currentComments: [],
  realtimeChannel: null,
  commentsPage: 1,
  commentsPerPage: 9,
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
  // Tickets pagination
  currentTicketPage: 1,
  ticketsPerPage: 9,
  totalTickets: 0,
  // Admin pagination
  adminCommentsPage: 1,
  adminCommentsPerPage: 9,
  totalAdminComments: 0,
  adminTicketsPage: 1,
  adminTicketsPerPage: 9,
  totalAdminTickets: 0,
  adminPostsPage: 1,
  adminPostsPerPage: 9,
  totalAdminPosts: 0,
  // UI notices
  noticeTimer: null,
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
  
  // Обработчики пагинации
  byId('prevPage')?.addEventListener('click', () => {
    if (state.currentPage > 1) {
      goToPage(state.currentPage - 1);
    }
  });
  
  byId('nextPage')?.addEventListener('click', () => {
    const totalPages = Math.ceil(state.totalPosts / state.postsPerPage);
    if (state.currentPage < totalPages) {
      goToPage(state.currentPage + 1);
    }
  });

  // Пагинация тикетов (профиль)
  byId('myPrevTicketPage')?.addEventListener('click', () => {
    if (state.currentTicketPage > 1) {
      goToTicketPage(state.currentTicketPage - 1);
    }
  });
  byId('myNextTicketPage')?.addEventListener('click', () => {
    const totalTicketPages = Math.max(1, Math.ceil(state.totalTickets / state.ticketsPerPage));
    if (state.currentTicketPage < totalTicketPages) {
      goToTicketPage(state.currentTicketPage + 1);
    }
  });

  // Админ: пагинация
  byId('adminPrevTicketPage')?.addEventListener('click', () => {
    if (state.adminTicketsPage > 1) loadAdminTickets(state.adminTicketsPage - 1);
  });
  byId('adminNextTicketPage')?.addEventListener('click', () => {
    const total = Math.max(1, Math.ceil(state.totalAdminTickets / state.adminTicketsPerPage));
    if (state.adminTicketsPage < total) loadAdminTickets(state.adminTicketsPage + 1);
  });
  byId('adminPrevCommentPage')?.addEventListener('click', () => {
    if (state.adminCommentsPage > 1) loadAdminComments(state.adminCommentsPage - 1);
  });
  byId('adminNextCommentPage')?.addEventListener('click', () => {
    const total = Math.max(1, Math.ceil(state.totalAdminComments / state.adminCommentsPerPage));
    if (state.adminCommentsPage < total) loadAdminComments(state.adminCommentsPage + 1);
  });
  
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

function renderAdminTicketsPagination(totalPages) {
  const wrap = byId('adminTicketsPagination');
  const prev = byId('adminPrevTicketPage');
  const next = byId('adminNextTicketPage');
  const nums = byId('adminTicketPageNumbers');
  if (!wrap || !prev || !next || !nums) return;
  if (state.totalAdminTickets <= state.adminTicketsPerPage) { wrap.hidden = true; return; }
  wrap.hidden = false;
  prev.disabled = state.adminTicketsPage === 1;
  const last = Math.max(1, Math.ceil(state.totalAdminTickets / state.adminTicketsPerPage));
  next.disabled = state.adminTicketsPage === last;
  nums.innerHTML = '';

  const maxVisible = 5;
  let start = Math.max(1, state.adminTicketsPage - Math.floor(maxVisible/2));
  let end = Math.min(last, start + maxVisible - 1);
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);

  const addNum = (n) => {
    const b = document.createElement('button');
    b.className = `page-number ${n === state.adminTicketsPage ? 'active' : ''}`;
    b.textContent = String(n);
    b.onclick = () => loadAdminTickets(n);
    nums.appendChild(b);
  };
  const addEll = () => { const s = document.createElement('span'); s.className = 'page-ellipsis'; s.textContent = '...'; nums.appendChild(s); };

  if (start > 1) { addNum(1); if (start > 2) addEll(); }
  for (let i = start; i <= end; i++) addNum(i);
  if (end < last) { if (end < last - 1) addEll(); addNum(last); }
  // bind prev/next once
  if (!wrap.dataset.bound) {
    prev.addEventListener('click', () => loadAdminTickets(Math.max(1, state.adminTicketsPage - 1)));
    next.addEventListener('click', () => loadAdminTickets(Math.min(last, state.adminTicketsPage + 1)));
    wrap.dataset.bound = '1';
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
  ticket: byId('route-ticket'),
};

function showRoute(name) {
  Object.values(routes).forEach(el => el.setAttribute('hidden', ''));
  routes[name]?.removeAttribute('hidden');
}

// Предзагрузка данных тикета (используется при открытии из админки)
async function prefetchTicketData(ticketId) {
  try {
    const { data: t } = await client.from('support_tickets').select('*').eq('id', ticketId).maybeSingle();
    if (t) localStorage.setItem(`nvx_ticket_meta_${t.id}` , JSON.stringify({ id: t.id, subject: t.subject, status: t.status, updated_at: t.updated_at, created_at: t.created_at, user_ip: t.user_ip, creator_name: t.creator_name }));
    const { data: msgs } = await client
      .from('support_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (Array.isArray(msgs) && msgs.length) localStorage.setItem(`nvx_ticket_msgs_${ticketId}`, JSON.stringify(msgs));
  } catch(_) { /* ignore */ }
}

function parseHash() {
  const h = location.hash || '#/';
  // allow both '#/route' and '#route' formats
  const raw = h.startsWith('#/') ? h.slice(2) : h.startsWith('#') ? h.slice(1) : h;
  // Strip query like '?id=..&admin=1' in hash tail for simple parsing
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  // patterns: home => '', 'home'; post => 'p/:slug'; admin => 'admin'
  if (parts.length === 0 || parts[0] === 'home') return { page: 'home' };
  if (parts[0] === 'p' && parts[1]) return { page: 'post', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'profile') return { page: 'profile' };
  if (parts[0] === 'admin') return { page: 'admin' };
  if (parts[0] === 'ticket') {
    if (parts[1]) return { page: 'ticket', id: parts[1] };
    // also allow '#/ticket?id=...'
    if (queryPart) {
      const q = new URLSearchParams(queryPart);
      const id = q.get('id');
      if (id) return { page: 'ticket', id };
    }
    return { page: 'ticket' };
  }
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
    await loadHome(1);
  } else if (r.page === 'post') {
    showRoute('post');
    await openPostBySlug(r.slug);
  } else if (r.page === 'profile') {
    // Guard: требуем хотя бы 1 комментарий до доступа к профилю
    const allowed = await ensureProfileAllowed();
    if (!allowed) return; // редирект и уведомление обработаны внутри
    showRoute('profile');
    await loadProfile();
    await loadMyTickets();
    initProfileTabs();
    setActiveProfileTab(state.activeProfileTab || 'tickets');
  } else if (r.page === 'admin') {
    showRoute('admin');
    await ensureAuthUI();
  } else if (r.page === 'ticket') {
    showRoute('ticket');
    console.debug('[router] ticket route (clean)', r);
    await loadTicketClean(r.id);
  }
}

// Проверка допуска к профилю: должен быть хотя бы 1 комментарий (по IP)
async function ensureProfileAllowed() {
  try {
    // Убедимся, что знаем IP
    await fetchUserIP().catch(() => {});
    if (!state.userIP) {
      showAccessNotice('Не удалось определить IP. Профиль доступен после первого комментария.');
      location.hash = '#/';
      return false;
    }
    // Считаем комментарии по IP (только количество)
    const { count, error } = await client
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('user_ip', state.userIP);
    if (error) {
      console.warn('ensureProfileAllowed error:', error);
      showAccessNotice('Ошибка проверки доступа к профилю. Попробуйте позже.');
      location.hash = '#/';
      return false;
    }
    if (!count || count < 1) {
      showAccessNotice('Профиль откроется после первого комментария. Оставьте комментарий под любой публикацией.');
      location.hash = '#/';
      return false;
    }
    return true;
  } catch (e) {
    console.warn('ensureProfileAllowed exception:', e);
    showAccessNotice('Не удалось проверить доступ к профилю. Попробуйте позже.');
    location.hash = '#/';
    return false;
  }
}

// Небольшое уведомление вверху страницы
function showAccessNotice(msg) {
  const el = byId('accessNotice');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.hidden = false;
  el.classList.add('visible');
  if (state.noticeTimer) clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => {
    hideAccessNotice();
  }, 5000);
}

function hideAccessNotice() {
  const el = byId('accessNotice');
  if (!el) return;
  el.classList.remove('visible');
  el.hidden = true;
}

// -------------- Clean Ticket Loader (stateless)
async function loadTicketClean(ticketId) {
  const titleEl = byId('tTitle');
  const metaEl = byId('tMeta');
  const threadEl = byId('tThread');
  const emptyEl = byId('tEmpty');
  const replyWrap = byId('tReply');
  const input = byId('replyInput');
  const btn = byId('replyBtn');

  // Show skeleton loader
  if (threadEl) {
    threadEl.innerHTML = createTicketSkeleton();
    threadEl.classList.remove('content-loaded');
  }
  if (emptyEl) emptyEl.hidden = true;
  if (replyWrap) replyWrap.hidden = true;
  if (titleEl) titleEl.textContent = 'Тикет';
  if (metaEl) {
    metaEl.innerHTML = '<div class="loading-text"><div class="loading-spinner"></div>Загрузка тикета...</div>';
  }

  if (!ticketId) { if (titleEl) titleEl.textContent = 'Тикет не указан'; if (metaEl) metaEl.textContent = '—'; return; }

  // 1) Ticket
  const { data: t, error: te } = await client
    .from('support_tickets')
    .select('id, subject, status, updated_at, created_at, user_ip, creator_name')
    .eq('id', ticketId)
    .maybeSingle();
  if (te || !t) {
    if (titleEl) titleEl.textContent = 'Тикет не найден';
    if (metaEl) metaEl.textContent = te?.message || '—';
    return;
  }
  // Параллельно тянем: seq-count, сообщения и имя по IP
  const seqPromise = client
    .from('support_tickets')
    .select('*', { count: 'exact', head: true })
    .lte('created_at', t.created_at);
  const msgsPromise = client
    .from('support_messages')
    .select('id, created_at, body, author_role, author_name')
    .eq('ticket_id', t.id)
    .order('created_at', { ascending: true });
  const ipNamePromise = t.user_ip
    ? client.from('ip_names').select('author_name').eq('ip', t.user_ip).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [seqRes, msgsRes, ipnRes] = await Promise.all([seqPromise, msgsPromise, ipNamePromise]);
  const { count: seqCount, error: seqErr } = seqRes || {};
  const { data: msgs, error: me } = msgsRes || {};
  const ticketUserName = ipnRes?.data?.author_name || null;

  // Человекопонятный номер тикета
  const pad3 = (n) => String(n).padStart(3, '0');
  let seqText = '';
  if (!seqErr && typeof seqCount === 'number') seqText = pad3(seqCount);
  if (!seqText) {
    try {
      const hex = String(t.id).replace(/[^0-9a-f]/gi, '').slice(0, 6) || '000000';
      const n = parseInt(hex, 16) % 1000;
      seqText = pad3(n);
    } catch(_) { seqText = '000'; }
  }
  if (titleEl) titleEl.textContent = `Тикет ${seqText} — ${t.subject || ''}`;
  if (metaEl) metaEl.textContent = `${t.status === 'open' ? 'Открыт' : 'Закрыт'} · обновлён ${formatDate(t.updated_at || t.created_at)}`;

  // 2) Messages
  if (me) console.warn('[ticket] load messages error:', me);
  const list = Array.isArray(msgs) ? msgs : [];
  if (emptyEl) emptyEl.hidden = !!list.length;
  if (threadEl) {
    const content = list.map((m, i) => {
      const isAdmin = m.author_role === 'admin';
      const name = isAdmin ? 'Администратор' : (m.author_name || ticketUserName || t.creator_name || 'посетитель');
      const adminBadge = isAdmin ? '<span class="admin-label" title="Сообщение администратора">ADMIN</span>' : '';
      return `
        <div class="comment ${isAdmin ? 'comment-admin' : ''}">
          <div class="comment-header">
            <div class="comment-author">
              <div class="num-badge" aria-label="Номер сообщения">${i + 1}</div>
              <div class="name">${escapeHtml(name)} ${adminBadge}</div>
            </div>
            <span class="comment-time">${formatDate(m.created_at)}</span>
          </div>
          <div class="comment-body">${renderMarkdownInline(escapeHtml(m.body || ''))}</div>
        </div>
      `;
    }).join('');
    
    // Smooth transition from skeleton to content
    setTimeout(() => {
      threadEl.innerHTML = content;
      threadEl.classList.add('content-loaded');
    }, 300);
  }

  // 3) Reply UI
  if (replyWrap) {
    if (t.status === 'closed') {
      replyWrap.hidden = true;
    } else {
      replyWrap.hidden = false;
    }
  }
  if (btn) {
    btn.onclick = async () => {
      const text = (input?.value || '').trim();
      if (!text) { input?.focus(); return; }
      btn.disabled = true;
      try {
        const session = await getSession();
        const isAdmin = await checkIsAdmin(session?.user?.id);
        const author_name = isAdmin ? 'nevrqx admin' : (byId('profileName')?.textContent?.trim() || 'посетитель');
        const payload = {
          ticket_id: t.id,
          body: text,
          author_role: isAdmin ? 'admin' : 'user',
          author_name,
        };
        const { error: se } = await client.from('support_messages').insert(payload);
        if (se) return alert('Ошибка отправки: ' + se.message);
        if (input) input.value = '';
        await loadTicketClean(t.id);
      } finally {
        btn.disabled = false;
      }
    };
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
  
  // Show skeleton loader for comments
  if (listEl) {
    listEl.innerHTML = createCommentsSkeleton(5);
    listEl.classList.remove('content-loaded');
  }
  if (emptyEl) emptyEl.hidden = true;

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

  // Render simple flat list of user's comments with smooth transition
  const commentsHTML = comments.map(c => {
    const post = postMap.get(c.post_id);
    const postLink = post ? `<a class="post-link" href="#/p/${encodeURIComponent(post.slug)}">${escapeHtml(post.title || 'Пост')}</a>` : `<span class="post-link muted">Пост #${c.post_id}</span>`;
    const name = (c.author_name || 'Гость').trim();
    const initial = escapeHtml((name[0] || '?').toUpperCase());
    return `
      <div class="comment${c.flagged ? ' flagged' : ''}">
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
      </div>
    `;
  }).join('');
  
  // Smooth transition from skeleton to content
  setTimeout(() => {
    if (listEl) {
      listEl.innerHTML = commentsHTML;
      listEl.classList.add('content-loaded');
    }
  }, 300);
}

// -------------- Profile: Account & Data
function setUserDeleteStatus(text, isError = false) {
  const el = byId('userDeleteStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('muted', !isError);
  el.classList.toggle('error', !!isError);
}

function initAccountSection() {
  // Populate status info
  (async () => {
    try {
      await fetchUserIP().catch(() => {});
      await checkAndLockName().catch(() => {});
    } catch {}
    const ip = state.userIP || '—';
    const accIP = byId('accIP');
    const accNameStatus = byId('accNameStatus');
    if (accIP) accIP.textContent = ip;
    if (accNameStatus) accNameStatus.textContent = state.lockedName ? `Ник закреплён: "${state.lockedName}"` : 'Ник не закреплён';
  })();

  // Bind delete button once
  const btn = byId('btnDeleteMyData');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', onUserDeleteMyData);
  }
}

async function onUserDeleteMyData() {
  try {
    await fetchUserIP().catch(() => {});
    if (!state.userIP) { setUserDeleteStatus('Не удалось определить IP. Повторите позже.', true); return; }
    const ok = await showUserDeleteConfirmDialog();
    if (!ok) return;
    setUserDeleteStatus('🧹 Удаление ваших данных запущено...');
    await deleteMyDataByIP(state.userIP);
    setUserDeleteStatus('✅ Ваши данные удалены.');
    // Refresh related UI
    try {
      await loadProfile();
      await loadMyTickets(1);
      await loadNotifications();
      state.lockedName = null;
      await checkAndLockName();
      initAccountSection();
      updateProfileTabCounts();
    } catch {}
  } catch (e) {
    setUserDeleteStatus('❌ Ошибка удаления: ' + (e?.message || String(e)), true);
  }
}

async function deleteMyDataByIP(ip) {
  // Sequential, with per-step errors surfaced
  // Comments
  let r;
  r = await client.from('comments').delete().eq('user_ip', ip);
  if (r.error) throw new Error('Комментарии: ' + r.error.message);
  setUserDeleteStatus('📄 Комментарии удалены, продолжаем...');
  // Support messages
  r = await client.from('support_messages').delete().eq('user_ip', ip);
  if (r.error) throw new Error('Сообщения тикетов: ' + r.error.message);
  setUserDeleteStatus('💬 Сообщения тикетов удалены, продолжаем...');
  // Support tickets
  r = await client.from('support_tickets').delete().eq('user_ip', ip);
  if (r.error) throw new Error('Тикеты: ' + r.error.message);
  setUserDeleteStatus('🎫 Тикеты удалены, продолжаем...');
  // IP name
  r = await client.from('ip_names').delete().eq('ip', ip);
  if (r.error) throw new Error('Ник по IP: ' + r.error.message);
  setUserDeleteStatus('👤 Закреплённый ник удалён, продолжаем...');
  // Notifications (optional)
  try {
    const rn = await client.from('notifications').delete().eq('user_ip', ip);
    if (rn.error) console.warn('notifications delete warning:', rn.error);
    else setUserDeleteStatus('🔔 Уведомления очищены, завершаем...');
  } catch {}
}

// Dialog for user-side deletion confirmation
async function showUserDeleteConfirmDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal mega-confirm-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="modal-card" style="max-width: 520px;">
        <div class="modal-header" style="background: linear-gradient(135deg, var(--danger), #dc2626); color: white;">
          <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">⚠️ УДАЛЕНИЕ ЛИЧНЫХ ДАННЫХ</h3>
        </div>
        <div class="modal-body" style="padding: 20px;">
          <p style="margin:0 0 12px 0;">Будут удалены ваши данные, привязанные к текущему IP:</p>
          <ul style="margin: 0 0 12px 20px; color: var(--text-secondary);">
            <li>💬 Комментарии</li>
            <li>🎫 Тикеты поддержки и сообщения</li>
            <li>👤 Закреплённый ник (ip_names)</li>
            <li>🔔 Уведомления</li>
          </ul>
          <p style="margin:0 0 8px 0;">Действие <strong style="color: var(--danger);">необратимо</strong>.</p>
          <p class="small" style="margin:0; color: var(--text-muted);">Для подтверждения введите: <code style="background: var(--bg-card); padding: 2px 6px; border-radius: 4px; color: var(--danger); font-weight: 600;">УДАЛИТЬ МОИ ДАННЫЕ</code></p>
          <input type="text" id="userDelConfirmInput" placeholder="Введите фразу подтверждения..." style="margin-top: 10px; width: 100%; padding: 10px; border: 2px solid var(--border); border-radius: 8px; background: var(--bg-card); color: var(--text);">
        </div>
        <div class="modal-actions" style="padding: 14px 20px; border-top: 1px solid var(--border);">
          <button type="button" class="btn ghost" id="userDelCancel">Отмена</button>
          <button type="button" class="btn danger" id="userDelConfirm" disabled>🗑️ Удалить</button>
        </div>
      </form>`;

    document.body.appendChild(dialog);
    const input = dialog.querySelector('#userDelConfirmInput');
    const okBtn = dialog.querySelector('#userDelConfirm');
    const cancelBtn = dialog.querySelector('#userDelCancel');
    input.addEventListener('input', () => {
      const ok = input.value.trim() === 'УДАЛИТЬ МОИ ДАННЫЕ';
      okBtn.disabled = !ok;
      okBtn.style.opacity = ok ? '1' : '0.5';
    });
    okBtn.addEventListener('click', () => dialog.close('ok'));
    cancelBtn.addEventListener('click', () => dialog.close('cancel'));
    dialog.addEventListener('close', () => {
      const res = dialog.returnValue === 'ok';
      document.body.removeChild(dialog);
      resolve(res);
    });
    dialog.showModal();
    setTimeout(() => input.focus(), 60);
  });
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
  // Показываем загрузку сразу
  showAdminLoading();
  
  const session = await getSession();
  state.session = session || state.session;
  state.isAdmin = await checkIsAdmin(session?.user?.id);
  
  // Минимум 2 секунды загрузки для плавности
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const authEl = byId('adminAuth');
  const panelEl = byId('adminPanel');
  const loadingEl = byId('adminLoading');
  
  const hideAuth = !!state.isAdmin;
  const hidePanel = !state.isAdmin;
  
  // Скрываем загрузку
  if (loadingEl) loadingEl.hidden = true;
  
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

function showAdminLoading() {
  const authEl = byId('adminAuth');
  const panelEl = byId('adminPanel');
  let loadingEl = byId('adminLoading');
  
  // Создаем элемент загрузки если его нет
  if (!loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.id = 'adminLoading';
    loadingEl.className = 'admin-loading';
    loadingEl.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <h3>Загрузка админ панели</h3>
        <p>Проверяем права доступа...</p>
      </div>
    `;
    // Вставляем в админ роут
    const adminRoute = byId('route-admin');
    if (adminRoute) {
      adminRoute.appendChild(loadingEl);
    }
  }
  
  // Скрываем форму авторизации и панель
  if (authEl) authEl.hidden = true;
  if (panelEl) panelEl.hidden = true;
  loadingEl.hidden = false;
}

// ---- Админ: комментарии — загрузка, фильтрация и действия (пагинация 9)
async function loadAdminComments(page = state.adminCommentsPage || 1) {
  const sort = byId('adminCommentSort')?.value || 'desc';
  const status = byId('adminCommentAnswered')?.value || 'all';
  state.adminCommentsPage = page;
  // 1) Получаем общее кол-во родительских комментариев
  const { count: totalCount, error: eCount } = await client
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .is('parent_id', null);
  if (eCount) { console.error('loadAdminComments count:', eCount); return; }
  state.totalAdminComments = totalCount || 0;
  // 2) Загружаем текущую страницу родителей
  const { from, to } = buildRange(page, state.adminCommentsPerPage);
  const { data: parents, error: e1 } = await client
    .from('comments')
    .select('*')
    .is('parent_id', null)
    .order('created_at', { ascending: sort === 'asc' })
    .range(from, to);
  if (e1) { console.error('loadAdminComments parents:', e1); return; }
  const parentIds = (parents || []).map(c => c.id);
  // 3) Загружаем ответы к ним
  let replies = [];
  if (parentIds.length) {
    const { data: rs, error: e2 } = await client
      .from('comments')
      .select('*')
      .in('parent_id', parentIds);
    if (e2) { console.error('loadAdminComments replies:', e2); }
    replies = rs || [];
  }
  // 4) Определяем статус (есть ли админ-ответ)
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
  // 5) Фильтрация по статусу (клиентская, пагинация по всем родителям)
  const filtered = items.filter(it =>
    status === 'all' ? true : status === 'answered' ? it.hasAdminReply : !it.hasAdminReply
  );
  renderAdminCommentsList(filtered);
  renderAdminCommentsPagination(Math.max(1, Math.ceil(state.totalAdminComments / state.adminCommentsPerPage)));
}

function renderAdminCommentsList(items) {
  const root = byId('adminCommentsList');
  if (!root) return;
  root.innerHTML = '';
  if (!Array.isArray(items) || !items.length) {
    setTimeout(() => {
      root.innerHTML = '<div class="muted" style="padding: var(--gap-lg); text-align: center;">У вас ещё нет тикетов</div>';
      root.classList.add('content-loaded');
    }, 300);
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
          <button class="btn ghost" data-admin-reply="${c.id}">Ответить как nevrqx admin</button>
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
    author_name: 'nevrqx admin',
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

// Утилита диапазона для .range(from, to)
function buildRange(page, perPage) {
  const from = (Math.max(1, page) - 1) * perPage;
  const to = from + perPage - 1;
  return { from, to };
}

// -------------- Posts (public)
async function loadHome(page = 1) {
  const postsEl = byId('posts');
  const emptyEl = byId('homeEmpty');
  
  // Show skeleton loader
  if (postsEl) {
    postsEl.innerHTML = createPostsSkeleton(6);
    postsEl.classList.remove('content-loaded');
  }
  if (emptyEl) emptyEl.hidden = true;
  
  const q = (byId('globalSearch')?.value || '').trim();
  state.currentSearchQuery = q.toLowerCase();
  state.currentPage = page;

  // 1) Получаем количество
  let countQuery = client
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString());
  if (q) {
    // Простейший OR по заголовку/описанию/тегам
    const ilike = `%${q}%`;
    countQuery = countQuery.or(`title.ilike.${ilike},description.ilike.${ilike}`);
  }
  const { count: totalCount } = await countQuery;
  state.totalPosts = totalCount || 0;

  // 2) Загружаем текущую страницу
  let dataQuery = client
    .from('posts')
    .select('*')
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false });
  if (q) {
    const ilike = `%${q}%`;
    dataQuery = dataQuery.or(`title.ilike.${ilike},description.ilike.${ilike}`);
  }
  const { from, to } = buildRange(page, state.postsPerPage);
  const { data, error } = await dataQuery.range(from, to);
  if (error) { console.error('loadHome:', error); return; }
  state.postsCache = data || [];
  renderPosts(state.postsCache);
  renderPagination(Math.max(1, Math.ceil(state.totalPosts / state.postsPerPage)));
}

// Больше не режем на клиенте — рендерим пришедшую страницу

function renderPosts(items) {
  const root = byId('posts');
  root.innerHTML = '';
  if (!items?.length) { 
    byId('homeEmpty').hidden = false; 
    byId('postsPagination').hidden = true;
    return; 
  }
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
    `;
    el.onclick = () => { location.hash = `#/p/${encodeURIComponent(p.slug)}`; };
    root.appendChild(el);
  }
  // Add smooth fade-in animation
  setTimeout(() => root.classList.add('content-loaded'), 50);
}

function renderPagination(totalPages) {
  const paginationEl = byId('postsPagination');
  const prevBtn = byId('prevPage');
  const nextBtn = byId('nextPage');
  const pageNumbersEl = byId('pageNumbers');
  
  if (totalPages <= 1) {
    paginationEl.hidden = true;
    return;
  }
  
  paginationEl.hidden = false;
  
  // Обновляем кнопки назад/вперед
  prevBtn.disabled = state.currentPage === 1;
  nextBtn.disabled = state.currentPage === totalPages;
  
  // Генерируем номера страниц
  pageNumbersEl.innerHTML = '';
  
  const maxVisiblePages = 5;
  let startPage = Math.max(1, state.currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  // Корректируем если мало страниц в конце
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  
  // Первая страница и многоточие
  if (startPage > 1) {
    addPageNumber(1);
    if (startPage > 2) {
      addEllipsis();
    }
  }
  
  // Видимые страницы
  for (let i = startPage; i <= endPage; i++) {
    addPageNumber(i);
  }
  
  // Многоточие и последняя страница
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      addEllipsis();
    }
    addPageNumber(totalPages);
  }
  
  function addPageNumber(pageNum) {
    const pageEl = document.createElement('button');
    pageEl.className = `page-number ${pageNum === state.currentPage ? 'active' : ''}`;
    pageEl.textContent = pageNum;
    pageEl.onclick = () => goToPage(pageNum);
    pageNumbersEl.appendChild(pageEl);
  }
  
  function addEllipsis() {
    const ellipsis = document.createElement('span');
    ellipsis.className = 'page-ellipsis';
    ellipsis.textContent = '...';
    pageNumbersEl.appendChild(ellipsis);
  }
}

function goToPage(pageNum) {
  if (pageNum < 1 || pageNum > Math.ceil(state.totalPosts / state.postsPerPage)) return;
  loadHome(pageNum);
  // Плавная прокрутка к началу постов
  document.querySelector('#posts').scrollIntoView({ behavior: 'smooth' });
}

const handleGlobalSearch = () => {
  // Перезапрашиваем с сервера первую страницу с фильтром
  loadHome(1);
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
  const loadingEl = byId('commentsLoading');
  const listEl = byId('commentsList');
  
  // Show skeleton loader instead of loading text
  if (listEl && page === 1) {
    listEl.innerHTML = createCommentsSkeleton();
    listEl.classList.remove('content-loaded');
  }
  if (loadingEl) loadingEl.hidden = page > 1; // Only show for pagination
  
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
  if (loadingEl) loadingEl.hidden = true;
  state.isLoadingComments = false;
  
  if (error) {
    console.error('loadComments:', error);
    if (listEl && page === 1) {
      setTimeout(() => {
        listEl.innerHTML = '<div class="loading-text">Ошибка загрузки комментариев</div>';
      }, 300);
    }
    return;
  }
  
  state.currentComments = data || [];
  state.commentsPage = page;
  state.isLoadingComments = false;
  
  // Загружаем информацию о лайках пользователя
  await loadUserLikes(postId);
  
  hideCommentsLoading();
  // Smooth transition for initial load
  if (page === 1) {
    setTimeout(() => {
      renderComments();
      renderCommentsPagination();
      if (listEl) listEl.classList.add('content-loaded');
    }, 300);
  } else {
    renderComments();
    renderCommentsPagination();
  }
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

  // Убираем автоматический редирект в профиль после комментария
  // Пользователь может сам перейти в профиль когда захочет
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
  if (name === 'settings') bindAdminSettingsDanger();
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

async function loadAdminPosts(page = state.adminPostsPage || 1) {
  const search = (byId('adminSearch')?.value || '').trim();
  const status = byId('statusFilter')?.value || '';
  state.adminPostsPage = page;
  // Count
  let qCount = client.from('posts').select('*', { count: 'exact', head: true });
  if (status) qCount = qCount.eq('status', status);
  if (search) {
    const ilike = `%${search}%`;
    qCount = qCount.or(`title.ilike.${ilike},description.ilike.${ilike}`);
  }
  const { count: totalCount, error: eCount } = await qCount;
  if (eCount) { console.error('loadAdminPosts count:', eCount); return; }
  state.totalAdminPosts = totalCount || 0;
  // Page data
  const { from, to } = buildRange(page, state.adminPostsPerPage);
  let q = client
    .from('posts')
    .select('id, title, slug, description, status, pinned, published_at, scheduled_at, updated_at, tags')
    .order('updated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (search) {
    const ilike = `%${search}%`;
    q = q.or(`title.ilike.${ilike},description.ilike.${ilike}`);
  }
  const { data, error } = await q.range(from, to);
  if (error) { console.error('loadAdminPosts data:', error); return; }
  let items = data || [];
  // Backfill published_at for published posts missing it (best-effort)
  try {
    const missing = items.filter(p => p.status === 'published' && !p.published_at);
    if (missing.length) {
      await client.from('posts').update({ published_at: new Date().toISOString() }).in('id', missing.map(p => p.id));
    }
  } catch (e) { console.warn('Backfill published_at failed', e); }
  renderAdminPosts(items);
  renderAdminPostsPagination(Math.max(1, Math.ceil(state.totalAdminPosts / state.adminPostsPerPage)));
}

byId('statusFilter')?.addEventListener('change', () => loadAdminPosts(1));
byId('adminSearch')?.addEventListener('input', () => loadAdminPosts(1));

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
  
  // Show skeleton loader for notifications
  const list = byId('notifList');
  const empty = byId('notifEmpty');
  if (list) {
    list.innerHTML = createNotificationsSkeleton(4);
    list.classList.remove('content-loaded');
    list.hidden = false;
  }
  if (empty) empty.hidden = true;
  
  const { data, error } = await client
    .from('notifications')
    .select('*')
    .eq('user_ip', state.userIP)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.warn('notifications load:', error); return; }
  state.notifications = data || [];
  state.unreadNotifications = (state.notifications || []).filter(n => !n.read_at).length;
  
  // Smooth transition from skeleton to content
  setTimeout(() => {
    renderNotifications();
    updateNotifBadge();
  }, 300);
}

function renderNotifications() {
  const list = byId('notifList');
  const empty = byId('notifEmpty');
  if (!list) return;
  
  const items = state.notifications || [];
  if (!items.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    if (list) { list.hidden = true; }
    return;
  } else if (empty) empty.hidden = true;

  // Render notifications with smooth transition
  const notificationsHTML = items.map(n => {
    const kind = escapeHtml(n.kind || 'info');
    const text = renderNotifText(n);
    return `
      <div class="notif-item${n.read_at ? '' : ' unread'}">
        <div class="notif-kind">${kind}</div>
        <div class="notif-body">${text}</div>
        <div class="notif-time small muted">${formatDate(n.created_at)}</div>
      </div>
    `;
  }).join('');
  
  list.innerHTML = notificationsHTML;
  list.classList.add('content-loaded');
  list.hidden = false;
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

async function loadMyTickets(page = 1) {
  const listEl = byId('myTicketsList');
  if (!listEl) return;
  
  // Show skeleton loader
  listEl.innerHTML = createTicketsSkeleton();
  listEl.classList.remove('content-loaded');

  // Count
  const { count: totalCount } = await client
    .from('support_tickets')
    .select('*', { count: 'exact', head: true })
    .eq('user_ip', state.userIP);
  state.totalTickets = totalCount || 0;
  state.currentTicketPage = page;

  // Page
  const { from, to } = buildRange(page, state.ticketsPerPage);
  const { data: tickets, error } = await client
    .from('support_tickets')
    .select('*')
    .eq('user_ip', state.userIP)
    .order('updated_at', { ascending: false })
    .range(from, to);
  if (error) { console.warn('loadMyTickets:', error); return; }
  state.myTickets = tickets || [];
  // Load messages only for current page items
  state.ticketMessages.clear();
  const ids = state.myTickets.map(t => t.id);
  if (ids.length) {
    const { data: msgs, error: e2 } = await client
      .from('support_messages')
      .select('*')
      .in('ticket_id', ids);
    if (e2) { console.warn('loadMyTickets msgs:', e2); }
    (msgs || []).forEach(m => {
      const arr = state.ticketMessages.get(m.ticket_id) || [];
      arr.push(m);
      state.ticketMessages.set(m.ticket_id, arr);
    });
  }
  renderMyTickets(state.myTickets);
  renderMyTicketsPagination(Math.max(1, Math.ceil(state.totalTickets / state.ticketsPerPage)));
  setTimeout(updateProfileTabCounts, 0);
}

function renderMyTickets(items) {
  // Рендерим список слева (или выше) и детали выбранного тикета ниже
  const list = byId('myTicketsList');
  const empty = byId('myTicketsEmpty');
  const detail = byId('myTicketDetail');
  if (list) list.innerHTML = '';

  const src = items || state.myTickets || [];
  if (!src.length) {
    if (empty) empty.hidden = false;
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
    byId('myTicketsPagination')?.setAttribute('hidden','');
    return;
  } else if (empty) empty.hidden = true;

  // Список: «Тикет №001 — Тема», кликабельно
  const ul = document.createElement('div');
  ul.className = 'tickets-list';
  src.forEach((t, idx) => {
    const num = String(idx + 1).padStart(3, '0');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ticket-row';
    row.dataset.ticketId = String(t.id);
    row.innerHTML = `
      <div class="row between align-center" style="width:100%">
        <div class="row align-center gap-sm">
          <span class="badge small">№${num}</span>
          <span class="ellipsis">${escapeHtml(t.subject || '')}</span>
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

// Пагинация тикетов теперь серверная — рендерим текущую страницу

function renderMyTicketsPagination(totalPages) {
  const wrap = byId('myTicketsPagination');
  const prev = byId('myPrevTicketPage');
  const next = byId('myNextTicketPage');
  const nums = byId('myTicketPageNumbers');
  if (!wrap || !prev || !next || !nums) return;
  if (state.totalTickets <= state.ticketsPerPage) { wrap.hidden = true; return; }
  wrap.hidden = false;
  prev.disabled = state.currentTicketPage === 1;
  const last = Math.max(1, Math.ceil(state.totalTickets / state.ticketsPerPage));
  next.disabled = state.currentTicketPage === last;
  nums.innerHTML = '';

  const maxVisible = 5;
  let start = Math.max(1, state.currentTicketPage - Math.floor(maxVisible/2));
  let end = Math.min(last, start + maxVisible - 1);
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);

  const addNum = (n) => {
    const b = document.createElement('button');
    b.className = `page-number ${n === state.currentTicketPage ? 'active' : ''}`;
    b.textContent = String(n);
    b.onclick = () => goToTicketPage(n);
    nums.appendChild(b);
  };
  const addEll = () => { const s = document.createElement('span'); s.className = 'page-ellipsis'; s.textContent = '...'; nums.appendChild(s); };

  if (start > 1) { addNum(1); if (start > 2) addEll(); }
  for (let i = start; i <= end; i++) addNum(i);
  if (end < last) { if (end < last - 1) addEll(); addNum(last); }
}

function goToTicketPage(n) {
  const last = Math.max(1, Math.ceil(state.totalTickets / state.ticketsPerPage));
  if (n < 1 || n > last) return;
  loadMyTickets(n);
  byId('myTicketsList')?.scrollIntoView({ behavior: 'smooth' });
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

  // Сохраним метаданные тикета в кэш для возможного оффлайн/нет доступа
  try {
    if (t) localStorage.setItem(`nvx_ticket_meta_${t.id}` , JSON.stringify({ id: t.id, subject: t.subject, status: t.status, updated_at: t.updated_at, created_at: t.created_at, user_ip: t.user_ip, creator_name: t.creator_name }));
  } catch(_) {}
  // Попробуем предзагрузить полные данные (сообщения) перед переходом
  prefetchTicketData(t.id).catch(() => {});
  // Открываем внутри SPA — сохраняется сессия и админ-контекст
  try {
    location.hash = `#/ticket/${encodeURIComponent(t.id)}`;
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
            <button class="btn" data-reply-ticket="${t.id}">Ответить</button>
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
      <div class="comment">
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

// ---- Admin: Tickets (paged)
async function loadAdminTickets(page = state.adminTicketsPage || 1) {
  const list = byId('adminTicketsList');
  if (!state.isAdmin || !list) return;
  list.innerHTML = '<div class="loading-text">Загрузка тикетов...</div>';

  const status = byId('adminTicketStatus')?.value || 'open';
  const sort = byId('adminTicketSort')?.value || 'recent';
  try {
    // Count
    let qCount = client.from('support_tickets').select('*', { count: 'exact', head: true });
    if (status !== 'all') qCount = qCount.eq('status', status);
    const { count: total } = await qCount;
    state.totalAdminTickets = total || 0;
    state.adminTicketsPage = page;

    // Page
    let q = client.from('support_tickets').select('*');
    if (status !== 'all') q = q.eq('status', status);
    const orderCol = sort === 'updated' ? 'updated_at' : 'created_at';
    const { from, to } = buildRange(page, state.adminTicketsPerPage);
    const { data, error } = await q.order(orderCol, { ascending: false }).range(from, to);
    if (error) { list.innerHTML = `<div class="muted">Ошибка загрузки: ${escapeHtml(error.message)}</div>`; return; }
    renderAdminTicketsList(data || []);
    renderAdminTicketsPagination(Math.max(1, Math.ceil(state.totalAdminTickets / state.adminTicketsPerPage)));
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
    const num = String((idx + 1) + (state.adminTicketsPage - 1) * state.adminTicketsPerPage).padStart(3, '0');
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
        // Открыть внутри SPA с подсказкой, что пришли из админки
        state.ticketAdminHint = true;
        await prefetchTicketData(id);
        location.hash = `#/ticket/${encodeURIComponent(id)}`;
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
        state.ticketAdminHint = true;
        await prefetchTicketData(id);
        location.hash = `#/ticket/${encodeURIComponent(id)}`;
      }
    });
    root.dataset.clickBound = '1';
  }
}

// -------------- Footer year
byId('year').textContent = String(new Date().getFullYear());
