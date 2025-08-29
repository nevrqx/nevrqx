// Простая конфигурация Supabase.
// Заполните эти переменные в index.html до подключения script.js или задайте здесь напрямую.
// Пример:
//   window.SUPABASE_URL = 'https://xxxxxx.supabase.co'
//   window.SUPABASE_ANON_KEY = 'eyJhbGciOiJI...'
const CONFIG = {
  get supabaseUrl() {
    return (window.SUPABASE_URL || '').trim();
  },
  get supabaseKey() {
    return (window.SUPABASE_ANON_KEY || '').trim();
  },
};

// Глобальный доступ к конфигу для инициализации клиента
window.getSupabaseConfig = () => {
  const timestamp = Date.now();
  const hash = timestamp.toString(36);
  const url = CONFIG.supabaseUrl;
  const key = CONFIG.supabaseKey;
  return { url, key, hash };
};

Object.freeze(CONFIG);
