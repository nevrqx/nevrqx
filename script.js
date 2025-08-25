// Инициализация Supabase
const SUPABASE_URL = 'https://jyulgsazqoozrwlgslnd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HBnglG1XFnCk8EF4xvpggg_qmqKJ_th';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// Делаем клиент Supabase доступным глобально для других скриптов
window.supabaseClient = supabase;

// SQL для создания поля password в таблице posts:
// ALTER TABLE posts ADD COLUMN password TEXT;

// Константы
const ADMIN_PASSWORD = 'leo563903W';
const POSTS_PER_PAGE = 12;
const COMMENT_COOLDOWN = 10 * 1000; // 10 секунд в миллисекундах
const IP_STORAGE_KEY = 'user_ip_data';

// DOM элементы
const postsContainer = document.getElementById('posts-container');
const adminPanel = document.getElementById('admin-panel');
const editorContainer = document.getElementById('editor-container');
const loginBtn = document.getElementById('loginBtn');
const loginModal = document.getElementById('login-modal');
const closeModalBtn = document.querySelector('.close');
const passwordInput = document.getElementById('password');
const submitPasswordBtn = document.getElementById('submitPassword');
const loginError = document.getElementById('login-error');
const newPostBtn = document.getElementById('newPostBtn');
const savePostBtn = document.getElementById('savePostBtn');
const cancelPostBtn = document.getElementById('cancelPostBtn');
const closeAdminBtn = document.getElementById('closeAdminBtn');
const postTitleInput = document.getElementById('post-title');
const postPasswordInput = document.getElementById('post-password');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const currentPageSpan = document.getElementById('currentPage');
const totalPagesSpan = document.getElementById('totalPages');
const nameModal = document.getElementById('name-modal');
const authorNameInput = document.getElementById('author-name');
const submitNameBtn = document.getElementById('submit-name');
const nameError = document.getElementById('name-error');
const closeNameModalBtn = document.querySelector('.close-name-modal');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const searchResultsModal = document.getElementById('search-results-modal');
const closeSearchResultsBtn = document.querySelector('.close-search-results');
const searchResultsContainer = document.getElementById('search-results-container');
const searchQueryDisplay = document.getElementById('search-query-display');
const noResultsDiv = document.getElementById('no-results');
const passwordModal = document.getElementById('password-modal');
const postAccessPasswordInput = document.getElementById('post-access-password');
const submitPasswordModalBtn = document.getElementById('submit-password-btn');
const cancelPasswordModalBtn = document.getElementById('cancel-password-btn');
const passwordError = document.getElementById('password-error');

// Элементы модального окна для вставки изображения
const imageUrlModal = document.getElementById('image-url-modal');
const closeImageModalBtn = document.querySelector('.close-image-modal');
const imageUrlInput = document.getElementById('image-url');
const previewImageBtn = document.getElementById('preview-image-btn');
const insertImageBtn = document.getElementById('insert-image-btn');
const imagePreviewContainer = document.querySelector('.image-preview-container');
const imagePreview = document.querySelector('.image-preview');
const imageUrlError = document.getElementById('image-url-error');

// Состояние приложения
let isAdmin = false;
let editor;
let currentPostId = null;
let currentPage = 1;
let totalPages = 1;
let allPosts = [];
let currentArticle = null;
let authorName = '';
let userIP = '';
let lastCommentTime = parseInt(localStorage.getItem('last_comment_time') || '0');
let commentCooldownTimer = null;
let searchTimeout = null;
let currentPostPassword = null;
let imageInsertRange = null; // Позиция для вставки изображения по URL
let imageUploadRange = null; // Позиция для вставки загруженного изображения

// Делаем authorName глобальной переменной
window.authorName = authorName;

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    initQuillEditor();
    setupEventListeners();
    preventCopyAndZoom();
    checkAdminStatus();
    checkDatabaseConnection();
    getUserIP();
    checkStorageBucket(); // Проверка и создание хранилища для фотографий
    
    // Проверяем URL для отображения статьи или списка
    const urlParams = new URLSearchParams(window.location.search);
    const articleId = urlParams.get('id');
    
    if (articleId) {
        loadArticle(articleId);
    } else {
        loadPosts();
    }
});

// Получение IP адреса пользователя и проверка блокировки
async function getUserIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        userIP = data.ip;
        console.log('IP пользователя:', userIP);
        
        // Загружаем данные пользователя из Supabase по IP
        await loadUserNameByIP();
    } catch (error) {
        console.error('Ошибка при получении IP адреса:', error);
        userIP = 'unknown';
    }
}

// Загрузка имени пользователя по IP из Supabase
async function loadUserNameByIP() {
    try {
        if (!userIP || userIP === 'unknown') return;
        
        // Запрашиваем данные пользователя по IP
        const { data, error } = await supabase
            .from('users')
            .select('username, is_blocked, block_reason')
            .eq('ip_address', userIP)
            .single();
        
        if (error && error.code !== 'PGRST116') { // PGRST116 = не найдено
            console.error('Ошибка при загрузке пользователя по IP:', error);
            return;
        }
        
        if (data) {
            // Пользователь найден
            authorName = data.username;
            // Обновляем глобальную переменную для доступа из chat.js
            window.authorName = authorName;
            // Сохраняем в localStorage для совместимости с чатом
            localStorage.setItem('author_name', authorName);
            console.log('Имя пользователя загружено по IP:', authorName);
            
            // Проверяем блокировку
            if (data.is_blocked) {
                showBlockedMessage(data.block_reason || 'Причина не указана');
                return;
            }
            
            // Обновляем отображение имени в интерфейсе
            updateAuthorNameDisplay();
        } else {
            // Если пользователь не найден, показываем модальное окно для ввода имени
            setTimeout(() => {
                showNameModal();
            }, 1000);
        }
    } catch (error) {
        console.error('Ошибка при загрузке пользователя по IP:', error);
    }
}

// Сохранение имени пользователя по IP в Supabase
async function saveUserNameByIP(name) {
    try {
        if (!userIP || userIP === 'unknown' || !name) return;
        
        // Проверяем, существует ли уже пользователь с таким IP
        const { data: existingUser, error: checkError } = await supabase
            .from('users')
            .select('id')
            .eq('ip_address', userIP)
            .single();
        
        if (checkError && checkError.code !== 'PGRST116') {
            console.error('Ошибка при проверке существующего пользователя:', checkError);
            return;
        }
        
        if (existingUser) {
            // Обновляем существующего пользователя
            const { error: updateError } = await supabase
                .from('users')
                .update({ username: name, updated_at: new Date() })
                .eq('ip_address', userIP);
                
            if (updateError) {
                console.error('Ошибка при обновлении пользователя:', updateError);
                return;
            }
        } else {
            // Создаем нового пользователя
            const { error: insertError } = await supabase
                .from('users')
                .insert([{ ip_address: userIP, username: name }]);
                
            if (insertError) {
                console.error('Ошибка при создании пользователя:', insertError);
                return;
            }
        }
        
        authorName = name;
        console.log('Имя пользователя сохранено по IP:', name);
        
        // Обновляем отображение имени
        updateAuthorNameDisplay();
    } catch (error) {
        console.error('Ошибка при сохранении пользователя:', error);
    }
}

// Функция для отображения сообщения о блокировке
function showBlockedMessage(reason) {
    // Создаем элемент блокировки
    const blockOverlay = document.createElement('div');
    blockOverlay.classList.add('block-overlay');
    blockOverlay.style.position = 'fixed';
    blockOverlay.style.top = '0';
    blockOverlay.style.left = '0';
    blockOverlay.style.width = '100%';
    blockOverlay.style.height = '100%';
    blockOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    blockOverlay.style.zIndex = '9999';
    blockOverlay.style.display = 'flex';
    blockOverlay.style.justifyContent = 'center';
    blockOverlay.style.alignItems = 'center';
    blockOverlay.style.backdropFilter = 'blur(5px)';
    blockOverlay.style.WebkitBackdropFilter = 'blur(5px)';
    
    blockOverlay.innerHTML = `
        <div class="block-message" style="background: linear-gradient(135deg, #ff3333, #990000); color: white; padding: 30px; border-radius: 10px; text-align: center; max-width: 80%; box-shadow: 0 0 30px rgba(255, 0, 0, 0.5); animation: pulse 2s infinite;">
            <i class="fas fa-ban" style="font-size: 48px; margin-bottom: 20px;"></i>
            <h2 style="margin-top: 0; font-size: 24px; font-weight: bold;">Вы заблокированы</h2>
            <p style="font-size: 16px; margin: 15px 0;">Причина: ${reason}</p>
            <p style="font-size: 16px;">Обратитесь к администратору в Telegram: <a href="https://t.me/aunex" target="_blank" style="color: white; font-weight: bold; text-decoration: underline;">@aunex</a></p>
        </div>
    `;
    
    // Добавляем анимацию пульсации
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.03); }
            100% { transform: scale(1); }
        }
    `;
    
    // Добавляем элементы на страницу
    document.head.appendChild(style);
    document.body.appendChild(blockOverlay);
    
    // Блокируем прокрутку страницы
    document.body.style.overflow = 'hidden';
    
    // Добавляем анимацию появления
    blockOverlay.style.opacity = '0';
    blockOverlay.style.transition = 'opacity 0.5s ease-in-out';
    
    setTimeout(() => {
        blockOverlay.style.opacity = '1';
    }, 10);
}

// Функция для извлечения ID видео YouTube
function extractYoutubeId(url) {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : false;
}

// Функция для извлечения ID видео Vimeo
function extractVimeoId(url) {
    const regExp = /^.*(vimeo\.com\/)((channels\/[A-z]+\/)|(groups\/[A-z]+\/videos\/))?([0-9]+)/;
    const match = url.match(regExp);
    return match ? match[5] : false;
}

// Функция для извлечения ID видео ВКонтакте
function extractVkId(url) {
    const regExp = /^.*((vk\.com\/video)|(vk\.com\/clip)|(m\.vk\.com\/video))(-?[0-9]+_[0-9]+)/;
    const match = url.match(regExp);
    return match ? match[5] : false;
}

// Функция для обработки вставки видео
function processVideoUrl(url) {
    let videoUrl = url;
    let videoHtml = null;
    
    // YouTube
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const youtubeId = extractYoutubeId(url);
        if (youtubeId) {
            videoUrl = `https://www.youtube.com/embed/${youtubeId}`;
            videoHtml = `<iframe src="${videoUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
        }
    }
    // Vimeo
    else if (url.includes('vimeo.com')) {
        const vimeoId = extractVimeoId(url);
        if (vimeoId) {
            videoUrl = `https://player.vimeo.com/video/${vimeoId}`;
            videoHtml = `<iframe src="${videoUrl}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
        }
    }
    // ВКонтакте
    else if (url.includes('vk.com/video') || url.includes('vk.com/clip')) {
        const vkId = extractVkId(url);
        if (vkId) {
            videoUrl = `https://vk.com/video_ext.php?oid=${vkId.split('_')[0]}&id=${vkId.split('_')[1]}&hd=2`;
            videoHtml = `<iframe src="${videoUrl}" frameborder="0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
        }
    }
    
    return { videoUrl, videoHtml };
}

// Инициализация Quill редактора
function initQuillEditor() {
    if (document.getElementById('editor')) {
        // Добавляем красивый эффект загрузки редактора
        const editorContainer = document.getElementById('editor-container');
        if (editorContainer) {
            editorContainer.classList.add('loading-editor');
        }
        
        // Настраиваем дополнительные форматы для видео
        const Video = Quill.import('formats/video');
        
        // Переопределяем класс Video для лучшей поддержки разных платформ
        class CustomVideo extends Video {
            static create(value) {
                const node = super.create(value);
                const { videoHtml } = processVideoUrl(value);
                
                if (videoHtml) {
                    node.innerHTML = videoHtml;
                }
                
                return node;
            }
        }
        
        CustomVideo.tagName = 'DIV';
        CustomVideo.className = 'ql-video-container';
        Quill.register(CustomVideo, true);
        
        // Настройка редактора с расширенными опциями
        editor = new Quill('#editor', {
            theme: 'snow',
            placeholder: 'Напишите что-нибудь интересное...',
            modules: {
                toolbar: {
                    container: [
                    [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'align': [] }],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['link', 'image', 'upload-image', 'video'],
                    ['clean']
                ],
                    handlers: {
                        'image': function() {
            // Сохраняем текущую позицию курсора
            imageInsertRange = editor.getSelection();
            
            if (imageInsertRange) {
                // Сбрасываем состояние модального окна
                imageUrlInput.value = '';
                insertImageBtn.disabled = true;
                imagePreviewContainer.classList.add('hidden');
                imageUrlError.classList.add('hidden');
                imagePreview.innerHTML = '';
                
                // Показываем модальное окно
                imageUrlModal.classList.remove('hidden');
                setTimeout(() => {
                    imageUrlInput.focus();
                }, 100);
                            }
                        },
                        'upload-image': function() {
                            // Сохраняем текущую позицию курсора
                            imageUploadRange = editor.getSelection();
                            
                            if (imageUploadRange) {
                                // Показываем модальное окно для загрузки изображения
                                showImageUploadModal();
                            }
                        },
                        'video': function() {
                            const range = this.quill.getSelection();
                            const url = prompt('Вставьте URL видео (YouTube, Vimeo, ВКонтакте и др.):');
                            
                            if (url && range) {
                                const { videoUrl } = processVideoUrl(url);
                                this.quill.insertEmbed(range.index, 'video', videoUrl);
                                this.quill.setSelection(range.index + 1);
                            }
                        }
                    }
                },
                clipboard: {
                    matchVisual: false
                },
                history: {
                    delay: 1000,
                    maxStack: 50,
                    userOnly: true
                }
            }
        });
        
        // Добавляем классы для стилизации
        document.querySelector('.ql-toolbar').classList.add('editor-toolbar');
        document.querySelector('.ql-container').classList.add('editor-container');
        
        // Убираем класс загрузки
        setTimeout(() => {
            if (editorContainer) {
                editorContainer.classList.remove('loading-editor');
            }
            
            // Фокус на редактор при открытии
            setTimeout(() => {
                editor.focus();
            }, 100);
        }, 300);
        
        // Добавляем подсказки для кнопок панели инструментов
        const toolbarButtons = document.querySelectorAll('.ql-toolbar button');
        const tooltips = {
            'ql-bold': 'Полужирный',
            'ql-italic': 'Курсив',
            'ql-underline': 'Подчеркнутый',
            'ql-strike': 'Зачеркнутый',
            'ql-link': 'Вставить ссылку',
            'ql-image': 'Вставить изображение по URL',
            'ql-upload-image': 'Загрузить изображение с компьютера',
            'ql-video': 'Вставить видео',
            'ql-clean': 'Очистить форматирование'
        };
        
        toolbarButtons.forEach(button => {
            for (const className in tooltips) {
                if (button.classList.contains(className)) {
                    button.setAttribute('title', tooltips[className]);
                    break;
                }
            }
        });
        
        // Добавляем иконку для кнопки загрузки изображения
        const uploadImageButton = document.querySelector('.ql-upload-image');
        if (uploadImageButton) {
            uploadImageButton.innerHTML = '<i class="fas fa-upload"></i>';
            uploadImageButton.classList.add('custom-toolbar-button');
        }
    }
}

// Загрузка постов из Supabase
async function loadPosts() {
    try {
        postsContainer.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Загрузка публикаций...</div>';
        
        const { data, error } = await supabase
            .from('posts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        allPosts = data || [];
        totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE);
        
        updatePaginationUI();
        displayCurrentPagePosts();
    } catch (error) {
        console.error('Ошибка при загрузке публикаций:', error);
        postsContainer.innerHTML = `<p class="error"><i class="fas fa-exclamation-circle"></i> Ошибка при загрузке публикаций: ${error.message || 'Неизвестная ошибка'}</p>`;
    }
}

// Загрузка отдельной статьи
async function loadArticle(id) {
    try {
        document.querySelector('main').innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Загрузка статьи...</div>';
        
        const { data, error } = await supabase
            .from('posts')
            .select('*')
            .eq('id', id)
            .single();
            
        if (error) throw error;
        
        if (!data) {
            document.querySelector('main').innerHTML = '<div class="error"><i class="fas fa-exclamation-triangle"></i> Статья не найдена</div>';
            return;
        }
        
        currentArticle = data;
        
        // Проверяем, защищена ли статья паролем
        if (data.password && !isAdmin) {
            // Показываем модальное окно для ввода пароля
            showPasswordModal(data);
        } else {
            // Если пароля нет или пользователь - админ, показываем статью
            displayArticle(data);
        }
    } catch (error) {
        console.error('Ошибка при загрузке статьи:', error);
        document.querySelector('main').innerHTML = `<div class="error"><i class="fas fa-exclamation-circle"></i> Ошибка при загрузке статьи: ${error.message || 'Неизвестная ошибка'}</div>`;
    }
}

// Показать модальное окно для ввода пароля
function showPasswordModal(post) {
    // Сбрасываем предыдущие значения
    postAccessPasswordInput.value = '';
    passwordError.classList.remove('show');
    currentPostPassword = post.password;
    
    // Показываем модальное окно
    passwordModal.style.display = 'flex';
    setTimeout(() => {
        passwordModal.classList.add('show');
    }, 10);
    
    // Фокус на поле ввода пароля
    setTimeout(() => {
        postAccessPasswordInput.focus();
    }, 100);
    
    // Обработчик нажатия Enter
    function handleEnterKey(e) {
        if (e.key === 'Enter') {
            checkPostPassword();
        }
    }
    
    // Добавляем обработчик нажатия Enter
    postAccessPasswordInput.addEventListener('keyup', handleEnterKey);
    
    // Обработчик для кнопки подтверждения
    submitPasswordModalBtn.onclick = () => {
        checkPostPassword();
        // Удаляем обработчик после использования
        postAccessPasswordInput.removeEventListener('keyup', handleEnterKey);
    };
    
    // Обработчик для кнопки отмены
    cancelPasswordModalBtn.onclick = () => {
        passwordModal.classList.remove('show');
        setTimeout(() => {
            passwordModal.style.display = 'none';
            // Перенаправляем на главную страницу
            window.location.href = 'index.html';
        }, 300);
        // Удаляем обработчик после использования
        postAccessPasswordInput.removeEventListener('keyup', handleEnterKey);
    };
}

// Проверка пароля к посту
function checkPostPassword() {
    const enteredPassword = postAccessPasswordInput.value;
    
    if (enteredPassword === currentPostPassword) {
        // Если пароль верный, скрываем модальное окно и показываем статью
        passwordModal.classList.remove('show');
        setTimeout(() => {
            passwordModal.style.display = 'none';
            displayArticle(currentArticle);
        }, 300);
    } else {
        // Если пароль неверный, показываем сообщение об ошибке
        passwordError.classList.add('show');
        postAccessPasswordInput.value = '';
        postAccessPasswordInput.focus();
    }
}

// Отображение статьи
function displayArticle(article) {
    const date = new Date(article.created_at);
    const formattedDate = date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    
    const formattedTime = date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const articleHTML = `
        <a href="index.html" class="back-to-home"><i class="fas fa-arrow-left"></i><span class="btn-text">Вернуться к списку</span></a>
        
        <article class="article-page">
            <div class="article-header">
                <h1 class="article-title">${article.title}</h1>
                <div class="article-meta">
                    <div class="article-date"><i class="far fa-calendar-alt"></i> ${formattedDate}</div>
                    <div class="article-time"><i class="far fa-clock"></i> ${formattedTime}</div>
                </div>
                ${isAdmin ? `
                <div class="admin-buttons">
                    <button class="edit-btn" data-id="${article.id}" title="Редактировать"><i class="fas fa-edit"></i><span class="btn-text">Редактировать</span></button>
                    <button class="delete-btn" data-id="${article.id}" title="Удалить"><i class="fas fa-trash-alt"></i><span class="btn-text">Удалить</span></button>
                </div>
                ` : ''}
            </div>
            <div class="article-content post-content">${article.content}</div>
            
            <!-- Секция комментариев -->
            <div class="comments-section">
                <div class="comments-header">
                    <h3><i class="fas fa-comments"></i> Комментарии <span class="comments-count">0</span></h3>
                </div>
                
                <div class="comment-form">
                    <textarea id="comment-text" placeholder="Напишите ваш комментарий..."></textarea>
                    
                    <div class="comment-form-tools">
                        <div class="comment-attach-tools">
                            <button class="attach-photo-btn" title="Прикрепить фото">
                                <i class="fas fa-camera"></i> Фото
                            </button>
                        </div>
                    </div>
                    
                    <div class="comment-attachments"></div>
                    
                    <div class="comment-form-footer">
                        <div class="comment-author">
                            <i class="fas fa-user"></i> 
                            ${authorName ? `<span>${authorName}</span>` : '<button id="set-name-btn">Указать имя</button>'}
                        </div>
                        <button id="submit-comment" ${!authorName ? 'disabled' : ''}>
                            <i class="fas fa-paper-plane"></i>
                            <span class="btn-text">Отправить</span>
                        </button>
                    </div>
                    <div id="comment-cooldown" class="comment-time-left hidden">
                        <i class="fas fa-hourglass-half"></i> Вы сможете оставить следующий комментарий через <span id="cooldown-timer">10 сек.</span>
                    </div>
                </div>
                
                <div class="comments-list">
                    <!-- Здесь будут отображаться комментарии -->
                    <div class="loading"><i class="fas fa-spinner fa-spin"></i> Загрузка комментариев...</div>
                </div>
            </div>
        </article>
    `;
    
    document.querySelector('main').innerHTML = articleHTML;
    
    // Добавляем обработчики событий для кнопок админа
    if (isAdmin) {
        document.querySelector('.edit-btn').addEventListener('click', () => {
            editPost(article);
        });
        
        document.querySelector('.delete-btn').addEventListener('click', () => {
            if (confirm('Вы уверены, что хотите удалить эту публикацию?')) {
                deletePost(article.id);
            }
        });
    }
    
    // Обрабатываем видео в статье
    processVideosInContent(document.querySelector('.article-content'));
    
    // После отображения статьи обновляем отображение имени автора
    updateAuthorNameDisplay();
    
    // Загружаем комментарии
    loadComments(article.id);
    
    // Добавляем обработчики для комментариев
    const commentTextarea = document.getElementById('comment-text');
    const submitCommentBtn = document.getElementById('submit-comment');
    const setNameBtn = document.getElementById('set-name-btn');
    const attachPhotoBtn = document.querySelector('.attach-photo-btn');
    
    if (setNameBtn) {
        setNameBtn.addEventListener('click', showNameModal);
    }
    
    if (submitCommentBtn) {
        submitCommentBtn.addEventListener('click', () => {
            // Если имя еще не установлено, сначала показываем модальное окно
            if (!authorName) {
                showNameModal();
                return;
            }
            submitComment(article.id);
        });
    }
    
    if (commentTextarea) {
        commentTextarea.addEventListener('keyup', () => {
            submitCommentBtn.disabled = !commentTextarea.value.trim() || !authorName;
        });
        
        // Автоматически фокусируемся на поле ввода комментария
        setTimeout(() => {
            commentTextarea.focus();
        }, 500);
    }
    
    // Обработчик для кнопки прикрепления фото
    if (attachPhotoBtn) {
        attachPhotoBtn.addEventListener('click', () => {
            showUploadPhotoModal();
        });
    }
    
    // Проверяем кулдаун комментариев
    checkCommentCooldown();
}

// Функция для отображения комментария
function displayComment(comment, commentsContainer, isReply = false) {
    const commentDate = new Date(comment.created_at);
    const formattedDate = commentDate.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Создаем элемент комментария
    const commentElement = document.createElement('div');
    commentElement.classList.add('comment');
    commentElement.dataset.id = comment.id;
    
    // Проверяем наличие прикрепленных фотографий
    let photosHTML = '';
    if (comment.photos && comment.photos.length > 0) {
        photosHTML = '<div class="comment-photos">';
        comment.photos.forEach(photo => {
            photosHTML += `
                <div class="comment-photo" data-url="${photo.url}">
                    <img src="${photo.url}" alt="Прикрепленное фото">
                </div>
            `;
        });
        photosHTML += '</div>';
    }
    
    // Формируем HTML комментария
    commentElement.innerHTML = `
        <div class="comment-header">
            <div class="comment-author-info">
                <div class="comment-author-name">
                    <i class="fas fa-user"></i> ${comment.author_name}
                    ${comment.users && comment.users.is_blocked ? '<span class="blocked-status">(Заблокирован)</span>' : ''}
                </div>
            </div>
            <div class="comment-date"><i class="far fa-clock"></i> ${formattedDate}</div>
        </div>
        <div class="comment-content">${comment.content}</div>
        ${photosHTML}
        <div class="comment-actions">
            <button class="comment-action-btn reply-btn" data-id="${comment.id}">
                <i class="fas fa-reply"></i> Ответить
            </button>
            ${isAdmin ? `
                <button class="comment-action-btn comment-delete-btn" data-id="${comment.id}" data-post-id="${comment.post_id || currentArticle.id}">
                    <i class="fas fa-trash-alt"></i> Удалить
                </button>
            ` : ''}
        </div>
        <div class="reply-form" id="reply-form-${comment.id}">
            <textarea placeholder="Напишите ваш ответ..."></textarea>
            <div class="reply-form-footer">
                <div class="reply-to-info">
                    <i class="fas fa-reply"></i> Ответ для ${comment.author_name}
                </div>
                <div class="reply-buttons">
                    <button class="cancel-reply-btn">Отмена</button>
                    <button class="submit-reply-btn" data-parent="${comment.id}">Ответить</button>
                </div>
            </div>
        </div>
        <div class="comment-replies" id="replies-${comment.id}"></div>
    `;
    
    // Добавляем комментарий в контейнер
    commentsContainer.appendChild(commentElement);
    
    // Добавляем обработчики событий
    const replyBtn = commentElement.querySelector('.reply-btn');
    const cancelReplyBtn = commentElement.querySelector('.cancel-reply-btn');
    const submitReplyBtn = commentElement.querySelector('.submit-reply-btn');
    const deleteBtn = commentElement.querySelector('.comment-delete-btn');
    const replyForm = commentElement.querySelector('.reply-form');
    const replyTextarea = replyForm.querySelector('textarea');
    
    // Обработчик для кнопки "Ответить"
    if (replyBtn) {
        replyBtn.addEventListener('click', () => {
            // Если имя не установлено, показываем модальное окно
            if (!authorName) {
                showNameModal();
                return;
            }
            
            // Скрываем все формы ответов
            document.querySelectorAll('.reply-form').forEach(form => {
                form.classList.remove('active');
            });
            
            // Показываем форму ответа на этот комментарий
            replyForm.classList.add('active');
            replyTextarea.focus();
        });
    }
    
    // Обработчик для кнопки "Отмена"
    if (cancelReplyBtn) {
        cancelReplyBtn.addEventListener('click', () => {
            replyForm.classList.remove('active');
            replyTextarea.value = '';
        });
    }
    
    // Обработчик для кнопки "Ответить" в форме
    if (submitReplyBtn) {
        submitReplyBtn.addEventListener('click', () => {
            const replyText = replyTextarea.value.trim();
            if (replyText && authorName) {
                submitReply(comment.id, replyText);
            }
        });
    }
    
    // Обработчик для кнопки "Удалить"
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const commentId = deleteBtn.getAttribute('data-id');
            const postId = deleteBtn.getAttribute('data-post-id') || currentArticle.id;
            
            console.log('Удаление комментария:', commentId, 'из поста:', postId);
            
            if (confirm('Вы уверены, что хотите удалить этот комментарий?')) {
                deleteComment(commentId, postId);
            }
        });
    }
    
    // Добавляем обработчики для фотографий
    const photos = commentElement.querySelectorAll('.comment-photo');
    photos.forEach(photo => {
        photo.addEventListener('click', () => {
            const url = photo.dataset.url;
            if (url) {
                showLightbox(url);
            }
        });
    });
    
    return commentElement;
}

// Функция для отправки ответа на комментарий
async function submitReply(parentId, content) {
    try {
        // Проверяем кулдаун
        if (Date.now() - lastCommentTime < COMMENT_COOLDOWN) {
            showNotification('Вы можете оставлять комментарии не чаще, чем раз в ' + (COMMENT_COOLDOWN / 1000) + ' секунд', 'warning');
            return;
        }
        
        // Получаем форму ответа
        const replyForm = document.getElementById(`reply-form-${parentId}`);
        const replyTextarea = replyForm.querySelector('textarea');
        const submitBtn = replyForm.querySelector('.submit-reply-btn');
        
        // Блокируем кнопку отправки
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка...';
        
        // Проверяем, не заблокирован ли пользователь
        if (!userIP || userIP === 'unknown') {
            showNotification('Не удалось определить IP адрес. Пожалуйста, обновите страницу.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Ответить';
            return;
        }
        
        // Проверяем статус пользователя
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('is_blocked, block_reason')
            .eq('ip_address', userIP)
            .single();
            
        if (userError && userError.code !== 'PGRST116') {
            console.error('Ошибка при проверке статуса пользователя:', userError);
            showNotification('Произошла ошибка при проверке вашего статуса', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Ответить';
            return;
        }
        
        // Если пользователь заблокирован, показываем сообщение
        if (userData && userData.is_blocked) {
            showBlockedMessage(userData.block_reason || 'Причина не указана');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Ответить';
            return;
        }
        
        if (!content || !authorName) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Ответить';
            return;
        }
        
        // Получаем ID поста для этого комментария
        const { data: parentComment, error: parentError } = await supabase
            .from('comments')
            .select('post_id')
            .eq('id', parentId)
            .single();
            
        if (parentError) {
            console.error('Ошибка при получении родительского комментария:', parentError);
            showNotification('Не удалось отправить ответ на комментарий', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Ответить';
            return;
        }
        
        const postId = parentComment.post_id;
        
        // Отправляем ответ
        const { data, error } = await supabase
            .from('comments')
            .insert([
                {
                    post_id: postId,
                    parent_id: parentId,
                    author_name: authorName,
                    content: content,
                    author_ip: userIP,
                    author_id: userData.id // Добавляем author_id
                }
            ]);
            
        if (error) {
            console.error('Ошибка при отправке ответа:', error);
            showNotification('Произошла ошибка при отправке ответа', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Ответить';
            return;
        }
        
        // Обновляем время последнего комментария
        lastCommentTime = Date.now();
        localStorage.setItem('last_comment_time', lastCommentTime);
        
        // Очищаем форму и скрываем её
        replyTextarea.value = '';
        replyForm.classList.remove('active');
        
        // Обновляем комментарии
        loadComments(postId);
        
        // Показываем уведомление об успешной отправке
        showNotification('Ответ успешно отправлен', 'success');
    } catch (error) {
        console.error('Ошибка при отправке ответа:', error);
        showNotification('Произошла ошибка при отправке ответа', 'error');
        
        // Разблокируем кнопку отправки
        const replyForm = document.getElementById(`reply-form-${parentId}`);
        if (replyForm) {
            const submitBtn = replyForm.querySelector('.submit-reply-btn');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Ответить';
            }
        }
    }
}

// Функция для загрузки комментариев
async function loadComments(postId) {
    try {
        const commentsList = document.querySelector('.comments-list');
        if (!commentsList) return;
        
        console.log('Начинаем загрузку комментариев для поста:', postId);
        commentsList.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Загрузка комментариев...</div>';
        
        // Проверяем существование таблицы комментариев
        console.log('Проверяем существование таблицы комментариев...');
        const { count, error: checkError } = await supabase
            .from('comments')
            .select('*', { count: 'exact', head: true });
            
        if (checkError) {
            console.error('Ошибка при проверке таблицы комментариев:', checkError);
            if (checkError.code === '42P01') {
                console.error('Таблица комментариев не существует!');
                commentsList.innerHTML = `
                    <div class="no-comments">
                        <i class="fas fa-exclamation-triangle"></i>
                        <p>Функция комментариев недоступна. Таблица комментариев не существует.</p>
                    </div>
                `;
                
                // Если таблица не существует, создаем её
                if (isAdmin) {
                    await checkCommentsTable();
                }
                
                return;
            }
        }
        
        // Загружаем все комментарии для поста
        const { data: comments, error } = await supabase
            .from('comments')
            .select('*, users(is_blocked)') // Выбираем все поля из комментариев и is_blocked из связанной таблицы users
            .eq('post_id', postId)
            .order('created_at', { ascending: true });
            
        if (error) {
            console.error('Ошибка при загрузке комментариев:', error);
                commentsList.innerHTML = `
                    <div class="no-comments">
                        <i class="fas fa-exclamation-triangle"></i>
                    <p>Ошибка при загрузке комментариев. Пожалуйста, попробуйте позже.</p>
                    </div>
                `;
                return;
        }
        
        // Очищаем контейнер комментариев
        commentsList.innerHTML = '';
        
        // Обновляем счетчик комментариев
        const commentsCount = document.querySelector('.comments-count');
        if (commentsCount) {
            commentsCount.textContent = comments.length;
        }
        
        if (comments.length === 0) {
            commentsList.innerHTML = `
                <div class="no-comments">
                    <i class="fas fa-comment-slash"></i>
                    <p>Нет комментариев. Будьте первым, кто оставит комментарий!</p>
                </div>
            `;
            return;
        }
        
        // Сортируем комментарии: сначала корневые, потом ответы
        const rootComments = comments.filter(comment => !comment.parent_id);
        const replyComments = comments.filter(comment => comment.parent_id);
        
        // Отображаем корневые комментарии
        rootComments.forEach(comment => {
            displayComment(comment, commentsList);
            
            // Находим и отображаем ответы на этот комментарий
            const replies = replyComments.filter(reply => reply.parent_id === comment.id);
            if (replies.length > 0) {
                const repliesContainer = document.getElementById(`replies-${comment.id}`);
                replies.forEach(reply => {
                    displayComment(reply, repliesContainer, true);
                });
            }
        });
        
    } catch (error) {
        console.error('Ошибка при загрузке комментариев:', error);
        const commentsList = document.querySelector('.comments-list');
        if (commentsList) {
            commentsList.innerHTML = `
                <div class="no-comments">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Произошла ошибка при загрузке комментариев. Пожалуйста, попробуйте позже.</p>
                </div>
            `;
        }
    }
}

// Функция для показа модального окна загрузки фотографий
function showUploadPhotoModal() {
    const uploadPhotoModal = document.getElementById('upload-photo-modal');
    const closeUploadModalBtn = document.querySelector('.close-upload-modal');
    const photoFileInput = document.getElementById('photo-file-input');
    const uploadPhotoBtn = document.getElementById('upload-photo-btn');
    const uploadPreview = document.querySelector('.upload-preview');
    const uploadError = document.getElementById('upload-error');
    
    // Очищаем предыдущие данные
    uploadPreview.innerHTML = '';
    uploadPreview.classList.add('empty');
    uploadPhotoBtn.disabled = true;
    uploadError.classList.add('hidden');
    
    // Показываем модальное окно
    uploadPhotoModal.classList.remove('hidden');
    
    // Обработчик для закрытия модального окна
    closeUploadModalBtn.onclick = () => {
        uploadPhotoModal.classList.add('hidden');
    };
    
    // Обработчик для выбора файла
    photoFileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Проверяем тип файла
            if (!file.type.startsWith('image/')) {
                uploadError.textContent = 'Пожалуйста, выберите изображение';
                uploadError.classList.remove('hidden');
                uploadPreview.innerHTML = '';
                uploadPreview.classList.add('empty');
                uploadPhotoBtn.disabled = true;
                return;
            }
            
            // Проверяем размер файла (не более 5 МБ)
            if (file.size > 5 * 1024 * 1024) {
                uploadError.textContent = 'Размер файла не должен превышать 5 МБ';
                uploadError.classList.remove('hidden');
                uploadPreview.innerHTML = '';
                uploadPreview.classList.add('empty');
                uploadPhotoBtn.disabled = true;
                return;
            }
            
            // Показываем предпросмотр
            const reader = new FileReader();
            reader.onload = (e) => {
                uploadPreview.innerHTML = `<img src="${e.target.result}" alt="Предпросмотр">`;
                uploadPreview.classList.remove('empty');
                uploadPhotoBtn.disabled = false;
                uploadError.classList.add('hidden');
            };
            reader.readAsDataURL(file);
        }
    };
    
    // Обработчик для кнопки загрузки
    uploadPhotoBtn.onclick = () => {
        uploadPhoto();
    };
}

// Функция для загрузки фотографии
async function uploadPhoto() {
    const uploadPhotoModal = document.getElementById('upload-photo-modal');
    const photoFileInput = document.getElementById('photo-file-input');
    const uploadPhotoBtn = document.getElementById('upload-photo-btn');
    const uploadProgress = document.querySelector('.upload-progress');
    const progressBarFill = document.querySelector('.progress-bar-fill');
    const progressText = document.querySelector('.progress-text');
    const uploadError = document.getElementById('upload-error');
    
    // Проверяем, выбран ли файл
    const file = photoFileInput.files[0];
    if (!file) {
        uploadError.textContent = 'Пожалуйста, выберите файл';
        uploadError.classList.remove('hidden');
            return;
        }
        
    try {
        // Показываем индикатор прогресса
        uploadProgress.classList.remove('hidden');
        uploadPhotoBtn.disabled = true;
        
        // Генерируем уникальное имя файла
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
        const filePath = `photos/${fileName}`;
        
        // Загружаем файл в Supabase Storage
        const { data, error } = await supabase.storage
            .from('comments-photos')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                onUploadProgress: (progress) => {
                    const percent = Math.round((progress.loaded / progress.total) * 100);
                    progressBarFill.style.width = `${percent}%`;
                    progressText.textContent = `${percent}%`;
                }
            });
            
        if (error) {
            throw error;
        }
        
        // Получаем публичный URL файла
        const { data: publicURL } = supabase.storage
            .from('comments-photos')
            .getPublicUrl(filePath);
            
        // Добавляем миниатюру в форму комментария
        addPhotoThumbnail(publicURL.publicUrl);
        
        // Показываем уведомление об успешной загрузке
        showNotification('Фотография успешно загружена', 'success');
        
        // Закрываем модальное окно
        uploadPhotoModal.classList.add('hidden');
        
        // Сбрасываем форму
        photoFileInput.value = '';
        
    } catch (error) {
        console.error('Ошибка при загрузке фото:', error);
        uploadError.textContent = `Ошибка при загрузке фото: ${error.message || 'Пожалуйста, попробуйте еще раз'}`;
        uploadError.classList.remove('hidden');
        
        // Показываем уведомление об ошибке
        showNotification('Не удалось загрузить фотографию', 'error');
    } finally {
        // Скрываем индикатор прогресса
        uploadProgress.classList.add('hidden');
        uploadPhotoBtn.disabled = false;
    }
}

// Функция для добавления миниатюры фото в форму комментария
function addPhotoThumbnail(url) {
    const attachmentsContainer = document.querySelector('.comment-attachments');
    if (!attachmentsContainer) return;
    
    // Создаем элемент миниатюры
    const thumbnail = document.createElement('div');
    thumbnail.classList.add('comment-attachment');
    thumbnail.dataset.url = url;
    thumbnail.innerHTML = `
        <img src="${url}" alt="Прикрепленное фото">
        <button class="remove-attachment" title="Удалить"><i class="fas fa-times"></i></button>
    `;
    
    // Добавляем миниатюру в контейнер
    attachmentsContainer.appendChild(thumbnail);
    
    // Добавляем обработчик для кнопки удаления
    const removeBtn = thumbnail.querySelector('.remove-attachment');
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        thumbnail.remove();
    });
}

// Функция для отправки комментария
async function submitComment(postId) {
    try {
        // Проверяем кулдаун
        if (Date.now() - lastCommentTime < COMMENT_COOLDOWN) {
            const cooldownElement = document.getElementById('comment-cooldown');
            if (cooldownElement) {
                cooldownElement.classList.remove('hidden');
                updateCooldownTimer();
            }
            return;
        }
        
        // Проверяем, не заблокирован ли пользователь
        if (!userIP || userIP === 'unknown') {
            showNotification('Не удалось определить IP адрес. Пожалуйста, обновите страницу.', 'error');
            return;
        }
        
        // Проверяем статус пользователя
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('is_blocked, block_reason')
            .eq('ip_address', userIP)
            .single();
            
        if (userError && userError.code !== 'PGRST116') {
            console.error('Ошибка при проверке статуса пользователя:', userError);
            showNotification('Произошла ошибка при проверке вашего статуса', 'error');
            return;
        }
        
        // Если пользователь заблокирован, показываем сообщение
        if (userData && userData.is_blocked) {
            showBlockedMessage(userData.block_reason || 'Причина не указана');
            return;
        }
        
        const commentText = document.getElementById('comment-text').value.trim();
        const submitBtn = document.getElementById('submit-comment');
        
        if (!commentText || !authorName) {
            return;
        }
        
        // Блокируем кнопку отправки
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка...';
        
        // Собираем прикрепленные фотографии
        const attachments = [];
        document.querySelectorAll('.comment-attachment').forEach(attachment => {
            const url = attachment.dataset.url;
            if (url) {
                attachments.push({ url });
            }
        });
        
        // Отправляем комментарий
        const { data, error } = await supabase
            .from('comments')
            .insert([
                {
                    post_id: postId,
                    author_name: authorName,
                    content: commentText,
                    author_ip: userIP,
                    author_id: userData.id, // Добавляем author_id
                    photos: attachments
                }
            ]);
            
        if (error) {
            console.error('Ошибка при отправке комментария:', error);
            showNotification('Произошла ошибка при отправке комментария. Пожалуйста, попробуйте еще раз.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span class="btn-text">Отправить</span>';
                return;
        }
        
        // Обновляем время последнего комментария
        lastCommentTime = Date.now();
        localStorage.setItem('last_comment_time', lastCommentTime);
        
        // Очищаем форму
        document.getElementById('comment-text').value = '';
        document.querySelector('.comment-attachments').innerHTML = '';
        
        // Обновляем комментарии
        loadComments(postId);
        
        // Разблокируем кнопку отправки
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span class="btn-text">Отправить</span>';
        
        // Показываем кулдаун
        checkCommentCooldown();
        
        // Показываем уведомление об успешной отправке
        showNotification('Комментарий успешно отправлен', 'success');
    } catch (error) {
        console.error('Ошибка при отправке комментария:', error);
        showNotification('Произошла ошибка при отправке комментария', 'error');
    }
}

// Показать модальное окно для ввода имени
function showNameModal() {
    // Проверяем, есть ли уже сохраненное имя для этого IP
    const ipData = JSON.parse(localStorage.getItem(IP_STORAGE_KEY) || '{}');
    if (ipData[userIP]) {
        // Если имя уже сохранено, не показываем модальное окно
        authorName = ipData[userIP];
        
        // Обновляем UI
        const commentAuthor = document.querySelector('.comment-author');
        if (commentAuthor) {
            commentAuthor.innerHTML = `<i class="fas fa-user"></i> <span>${authorName}</span>`;
        }
        
        // Разблокируем кнопку отправки комментария, если есть текст
        const submitCommentBtn = document.getElementById('submit-comment');
        const commentText = document.getElementById('comment-text');
        if (submitCommentBtn && commentText) {
            submitCommentBtn.disabled = !commentText.value.trim();
        }
        
        return;
    }
    
    // Убедимся, что у модального окна есть нужные классы
    if (!nameModal.classList.contains('name-modal')) {
        nameModal.classList.add('name-modal');
    }
    
    // Используем функцию openNameModal для открытия с анимацией
    openNameModal();
    
    setTimeout(() => {
        authorNameInput.focus();
    }, 100);
    
    // Добавляем текст, объясняющий, что имя нельзя будет изменить
    const nameWarning = document.getElementById('name-warning');
    if (nameWarning) {
        nameWarning.textContent = 'Внимание! После сохранения имя нельзя будет изменить.';
    } else {
        const warningElem = document.createElement('p');
        warningElem.id = 'name-warning';
        warningElem.className = 'name-warning';
        warningElem.textContent = 'Внимание! После сохранения имя нельзя будет изменить.';
        
        const nameModalContent = document.querySelector('.modal-content');
        if (nameModalContent) {
            // Вставляем предупреждение перед кнопкой отправки
            const submitBtn = document.getElementById('submit-name');
            if (submitBtn) {
                nameModalContent.insertBefore(warningElem, submitBtn.parentNode);
            } else {
                nameModalContent.appendChild(warningElem);
            }
        }
    }
}

// Сохранение имени автора
async function saveAuthorName() {
    const name = authorNameInput.value.trim();
    nameError.classList.add('hidden');
    
    if (!name) {
        nameError.textContent = 'Пожалуйста, введите ваше имя';
        nameError.classList.remove('hidden');
        return;
    }
    
    if (name.length < 2) {
        nameError.textContent = 'Имя должно содержать не менее 2 символов';
        nameError.classList.remove('hidden');
        return;
    }
    
    if (name.length > 30) {
        nameError.textContent = 'Имя должно содержать не более 30 символов';
        nameError.classList.remove('hidden');
        return;
    }
    
    // Показываем индикатор загрузки
    submitNameBtn.disabled = true;
    submitNameBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
    
    try {
        // Сохраняем имя в Supabase
        await saveUserNameByIP(name);
    authorName = name;
    
        // Обновляем глобальную переменную для доступа из chat.js
        window.authorName = name;
    
        // Сохраняем в localStorage для совместимости с чатом
        localStorage.setItem('author_name', name);
        
        // Обновляем отображение имени
    updateAuthorNameDisplay();
    
        // Закрываем модальное окно
        closeNameModal();
        
        // Показываем уведомление
        showNotification(`Добро пожаловать, ${name}!`, 'success');
    } catch (error) {
        console.error('Ошибка при сохранении имени:', error);
        nameError.textContent = 'Произошла ошибка при сохранении имени. Пожалуйста, попробуйте еще раз.';
        nameError.classList.remove('hidden');
    } finally {
        // Восстанавливаем кнопку
        submitNameBtn.disabled = false;
        submitNameBtn.innerHTML = 'Сохранить';
    }
}

// Проверка кулдауна комментариев
function checkCommentCooldown() {
    const cooldownElement = document.getElementById('comment-cooldown');
    const submitCommentBtn = document.getElementById('submit-comment');
    
    if (!cooldownElement || !submitCommentBtn) return;
    
    const now = Date.now();
    const timeSinceLastComment = now - lastCommentTime;
    
    if (timeSinceLastComment < COMMENT_COOLDOWN) {
        // Если прошло меньше времени, чем кулдаун, показываем таймер
        cooldownElement.classList.remove('hidden');
        submitCommentBtn.disabled = true;
        
        // Запускаем обновление таймера
        updateCooldownTimer();
        
        // Если уже есть таймер, очищаем его
        if (commentCooldownTimer) {
            clearInterval(commentCooldownTimer);
        }
        
        // Создаем новый таймер, который обновляется каждую секунду
        commentCooldownTimer = setInterval(() => {
            const currentTime = Date.now();
            const elapsedTime = currentTime - lastCommentTime;
            
            if (elapsedTime >= COMMENT_COOLDOWN) {
                // Если кулдаун закончился, скрываем таймер и очищаем интервал
                clearInterval(commentCooldownTimer);
                commentCooldownTimer = null;
        cooldownElement.classList.add('hidden');
        
        // Разблокируем кнопку, если есть текст
        const commentText = document.getElementById('comment-text');
                if (commentText && commentText.value.trim()) {
                    submitCommentBtn.disabled = false;
                }
                
                return;
        }
        
            // Обновляем отображение таймера
            updateCooldownTimer();
        }, 1000);
    } else {
        // Если прошло больше времени, чем кулдаун, скрываем таймер
        cooldownElement.classList.add('hidden');
        
        // Разблокируем кнопку, если есть текст
        const commentText = document.getElementById('comment-text');
        if (commentText && commentText.value.trim()) {
            submitCommentBtn.disabled = false;
        }
    }
}

// Обновление таймера кулдауна
function updateCooldownTimer() {
    const cooldownTimerElement = document.getElementById('cooldown-timer');
    if (!cooldownTimerElement) return;
    
    const now = Date.now();
    const timeElapsed = now - lastCommentTime;
    const timeRemaining = Math.max(0, COMMENT_COOLDOWN - timeElapsed);
    
    // Преобразуем миллисекунды в секунды
    const secondsRemaining = Math.ceil(timeRemaining / 1000);
    
    // Форматируем время для отображения (в секундах)
    cooldownTimerElement.textContent = `${secondsRemaining} сек.`;
}

// Отображение текущей страницы постов
function displayCurrentPagePosts() {
    const start = (currentPage - 1) * POSTS_PER_PAGE;
    const end = start + POSTS_PER_PAGE;
    const postsToDisplay = allPosts.slice(start, end);
    
    displayPosts(postsToDisplay);
}

// Обновление UI пагинации
function updatePaginationUI() {
    currentPageSpan.textContent = currentPage;
    totalPagesSpan.textContent = totalPages;
    
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
}

// Отображение постов
function displayPosts(posts) {
    if (posts.length === 0) {
        postsContainer.innerHTML = '<p class="no-posts"><i class="fas fa-inbox"></i> Нет публикаций</p>';
        return;
    }

    let postsHTML = '';
    
    posts.forEach(post => {
        const date = new Date(post.created_at);
        const formattedDate = date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        
        const formattedTime = date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Извлекаем первые 150 символов контента для превью
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = post.content;
        const textContent = tempDiv.textContent || tempDiv.innerText;
        const preview = textContent.substring(0, 150) + (textContent.length > 150 ? '...' : '');
        
        // Проверяем, защищен ли пост паролем
        const isPasswordProtected = post.password ? true : false;
        
        postsHTML += `
            <div class="post" data-id="${post.id}">
                <h3 class="post-title">
                    ${post.title}
                    ${isPasswordProtected ? '<i class="fas fa-lock" title="Защищено паролем"></i>' : ''}
                </h3>
                <div class="post-header">
                    <div class="post-date"><i class="far fa-calendar-alt"></i> ${formattedDate}</div>
                    <div class="post-time"><i class="far fa-clock"></i> ${formattedTime}</div>
            </div>
                <p class="post-preview">${preview}</p>
            <div class="post-footer">
                    <a href="?id=${post.id}" class="read-more" title="Читать далее"><i class="fas fa-arrow-right"></i><span class="btn-text">Читать далее</span></a>
                    ${isAdmin ? `
                    <div class="admin-buttons">
                        <button class="edit-btn" data-id="${post.id}" title="Редактировать"><i class="fas fa-edit"></i><span class="btn-text">Редактировать</span></button>
                        <button class="delete-btn" data-id="${post.id}" title="Удалить"><i class="fas fa-trash-alt"></i><span class="btn-text">Удалить</span></button>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    });
    
    postsContainer.innerHTML = postsHTML;
    
    // Добавляем обработчики событий для кнопок админа
    if (isAdmin) {
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const postId = btn.dataset.id;
                const post = allPosts.find(p => p.id === postId);
                if (post) {
                editPost(post);
                }
            });
        });
        
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const postId = btn.dataset.id;
                if (confirm('Вы уверены, что хотите удалить эту публикацию?')) {
                    deletePost(postId);
                }
            });
        });
    }
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Обработчики для пагинации
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            updatePaginationUI();
            displayCurrentPagePosts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    
    nextPageBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            updatePaginationUI();
            displayCurrentPagePosts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    
    // Обработчик изменения размера окна для кнопки управления пользователями
    window.addEventListener('resize', () => {
        if (isAdmin) {
            if (window.innerWidth >= 768) {
                addUserManagementButton();
            } else {
                const headerBtn = document.getElementById('header-user-management-btn');
                if (headerBtn) {
                    headerBtn.style.display = 'none';
                }
                
                const adminIpInfo = document.getElementById('admin-ip-info');
                if (adminIpInfo) {
                    adminIpInfo.style.display = 'none';
                }
            }
        }
    });
    
    // Обработчики для входа в админ-панель
    loginBtn.addEventListener('click', () => {
        if (isAdmin) {
            showAdminPanel();
        } else {
            loginModal.classList.remove('hidden');
            setTimeout(() => {
            passwordInput.focus();
            }, 100);
        }
    });
    
    closeModalBtn.addEventListener('click', () => {
        loginModal.classList.add('hidden');
        loginError.classList.add('hidden');
        passwordInput.value = '';
    });
    
    passwordInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            checkPassword();
        }
    });
    
    submitPasswordBtn.addEventListener('click', checkPassword);
    
    // Обработчики для админ-панели
    closeAdminBtn.addEventListener('click', hideAdminPanel);
    
        newPostBtn.addEventListener('click', () => {
            currentPostId = null;
            postTitleInput.value = '';
            editor.root.innerHTML = '';
            editorContainer.classList.remove('hidden');
            postTitleInput.focus();
        });
    
        savePostBtn.addEventListener('click', savePost);
    
        cancelPostBtn.addEventListener('click', () => {
            editorContainer.classList.add('hidden');
        });
    
    // Добавляем обработчик для закрытия по клику вне модального окна
    window.addEventListener('click', (e) => {
        if (e.target === loginModal) {
            loginModal.classList.add('hidden');
            loginError.classList.add('hidden');
            passwordInput.value = '';
        }
    });
    
    // Добавляем обработчик для клавиши Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!loginModal.classList.contains('hidden')) {
                loginModal.classList.add('hidden');
                loginError.classList.add('hidden');
                passwordInput.value = '';
            }
            
            if (!adminPanel.classList.contains('hidden')) {
                hideAdminPanel();
            }
            
            if (!nameModal.classList.contains('hidden')) {
                nameModal.classList.add('hidden');
                nameError.classList.add('hidden');
            }
            
            if (!searchResultsModal.classList.contains('hidden')) {
                searchResultsModal.classList.add('hidden');
                document.body.style.overflow = 'auto';
            }
            
            if (!imageUrlModal.classList.contains('hidden')) {
                imageUrlModal.classList.add('hidden');
            }
        }
    });
    
    // Обработчики для модального окна ввода имени
    if (closeNameModalBtn) {
        closeNameModalBtn.addEventListener('click', () => {
            closeNameModal();
        });
    }
    
    if (submitNameBtn) {
        submitNameBtn.addEventListener('click', saveAuthorName);
    }
    
    if (authorNameInput) {
        authorNameInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                saveAuthorName();
            }
        });
    }
    
    // Добавляем обработчик для закрытия модального окна ввода имени по клику вне его
    window.addEventListener('click', (e) => {
        if (e.target === nameModal) {
            closeNameModal();
        }
    });
    
    // Обработчики для поиска
    if (searchInput) {
        // Поиск по нажатию Enter
        searchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    }
    
    if (searchButton) {
        searchButton.addEventListener('click', performSearch);
    }
    
    // Улучшенный обработчик для закрытия результатов поиска
    if (closeSearchResultsBtn) {
        closeSearchResultsBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation(); // Предотвращаем всплытие события
            searchResultsModal.classList.add('hidden');
            // Разблокируем прокрутку страницы
            document.body.style.overflow = 'auto';
            console.log('Search results modal closed');
        });
    }
    
    // Закрытие модальных окон по клику вне их содержимого
    window.addEventListener('click', (e) => {
        if (e.target === loginModal) {
            loginModal.classList.add('hidden');
        } else if (e.target === nameModal) {
            nameModal.classList.add('hidden');
        } else if (e.target === searchResultsModal) {
            searchResultsModal.classList.add('hidden');
            document.body.style.overflow = 'auto';
        }
    });
    
    // Обработчики для модального окна вставки изображения
    if (closeImageModalBtn) {
        closeImageModalBtn.addEventListener('click', () => {
            imageUrlModal.classList.add('hidden');
        });
    }
    
    if (imageUrlInput) {
        imageUrlInput.addEventListener('input', () => {
            // Проверяем URL на валидность
            const url = imageUrlInput.value.trim();
            insertImageBtn.disabled = !url;
            
            // Сбрасываем предпросмотр при изменении URL
            imagePreviewContainer.classList.add('hidden');
            imageUrlError.classList.add('hidden');
        });
        
        imageUrlInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && !insertImageBtn.disabled) {
                previewImage();
            }
        });
    }
    
    if (previewImageBtn) {
        previewImageBtn.addEventListener('click', previewImage);
    }
    
    if (insertImageBtn) {
        insertImageBtn.addEventListener('click', insertImage);
    }
    
    // Добавляем обработчик для закрытия модального окна вставки изображения по клику вне его
    window.addEventListener('click', (e) => {
        if (e.target === imageUrlModal) {
            imageUrlModal.classList.add('hidden');
        }
    });
    
    // Добавляем обработчик для клавиши Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // ... existing code ...
            
            if (!imageUrlModal.classList.contains('hidden')) {
                imageUrlModal.classList.add('hidden');
            }
        }
    });
}

// Загрузка поста для редактирования
async function loadPostForEdit(id) {
    try {
        editorContainer.classList.add('loading-editor');
        
        const { data, error } = await supabase
            .from('posts')
            .select('*')
            .eq('id', id)
            .single();
            
        if (error) throw error;
        
        if (data) {
            postTitleInput.value = data.title;
            editor.root.innerHTML = data.content;
            currentPostId = data.id;
        } else {
            throw new Error('Публикация не найдена');
        }
        
        editorContainer.classList.remove('loading-editor');
    } catch (error) {
        console.error('Ошибка при загрузке публикации для редактирования:', error);
        showNotification('Ошибка при загрузке публикации: ' + (error.message || 'Неизвестная ошибка'), 'error');
        editorContainer.classList.remove('loading-editor');
        hideAdminPanel(); // Закрываем панель администратора при ошибке
    }
}

// Функция для проверки статуса администратора и добавления кнопки управления пользователями
function checkAdminStatus() {
    const isAdminSaved = localStorage.getItem('adminToken') === 'true';
    
    if (isAdminSaved) {
        isAdmin = true;
        loginBtn.innerHTML = '<i class="fas fa-cog"></i><span class="btn-text">Админ панель</span>';
        loginBtn.title = 'Админ панель';
        
        // Добавляем кнопку управления пользователями в верхний колонтитул, если это ПК версия
        if (window.innerWidth >= 768) {
            addUserManagementButton();
        }
    }
}

// Функция для добавления кнопки управления пользователями в верхний колонтитул
function addUserManagementButton() {
    // Проверяем, что пользователь является администратором
    if (!isAdmin) return;
    
    // Проверяем, существует ли уже кнопка
    if (document.getElementById('header-user-management-btn')) return;
    
    // Проверяем наличие кнопки настроек (шестеренки)
    let settingsButton = document.querySelector('button[title="Настройки"], button[title="Settings"], .settings-button, button.settings, .settings, .setting-icon, button:has(i.fa-cog), button:has(i.fas.fa-cog), button:has(i.fa-gear), button:has(i.fas.fa-gear), .header button');
    
    // Если не нашли по стандартным селекторам, ищем по внешнему виду кнопки на скриншоте
    if (!settingsButton) {
        // Ищем все кнопки и проверяем их внешний вид
        const allButtons = document.querySelectorAll('button');
        for (const button of allButtons) {
            // Проверяем, содержит ли кнопка иконку шестеренки
            const hasSettingsIcon = button.innerHTML.includes('fa-cog') || 
                                   button.innerHTML.includes('fa-gear') || 
                                   button.innerHTML.includes('settings') ||
                                   button.innerHTML.includes('⚙');
            
            // Проверяем, похожа ли кнопка на ту, что на скриншоте (круглая, в верхней части экрана)
            const isRoundButton = window.getComputedStyle(button).borderRadius === '50%' || 
                                 button.style.borderRadius === '50%';
            
            if (hasSettingsIcon || isRoundButton) {
                settingsButton = button;
                break;
            }
        }
    }
    
    // Если все еще не нашли, ищем по позиции на странице (верхняя правая часть)
    if (!settingsButton) {
        const topRightElements = Array.from(document.querySelectorAll('*')).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.top < 100 && rect.right > window.innerWidth - 100;
        });
        
        // Ищем среди верхних правых элементов что-то похожее на кнопку настроек
        for (const el of topRightElements) {
            if (el.tagName === 'BUTTON' || 
                el.tagName === 'A' || 
                el.role === 'button' || 
                window.getComputedStyle(el).cursor === 'pointer') {
                settingsButton = el;
                break;
            }
        }
    }
    
    if (settingsButton) {
        // Если кнопка настроек найдена, добавляем нашу кнопку рядом с ней
        const userManagementBtn = createUserManagementButton();
        
        // Проверяем, есть ли у кнопки настроек родитель
        if (settingsButton.parentNode) {
            // Вставляем кнопку управления пользователями рядом с кнопкой настроек
            settingsButton.parentNode.insertBefore(userManagementBtn, settingsButton.nextSibling);
            
            // Копируем некоторые стили от кнопки настроек для лучшей визуальной совместимости
            try {
                const settingsStyles = window.getComputedStyle(settingsButton);
                if (settingsStyles.backgroundColor && settingsStyles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                    userManagementBtn.style.backgroundColor = settingsStyles.backgroundColor;
                }
                if (settingsStyles.color) {
                    userManagementBtn.style.color = settingsStyles.color;
                }
                if (settingsStyles.width && settingsStyles.width !== 'auto') {
                    userManagementBtn.style.width = settingsStyles.width;
                }
                if (settingsStyles.height && settingsStyles.height !== 'auto') {
                    userManagementBtn.style.height = settingsStyles.height;
                }
                if (settingsStyles.borderRadius) {
                    userManagementBtn.style.borderRadius = settingsStyles.borderRadius;
                }
            } catch (e) {
                console.error('Ошибка при копировании стилей:', e);
            }
            
            // Добавляем стиль для позиционирования
            const style = document.createElement('style');
            style.textContent = `
                #header-user-management-btn {
                    margin-left: 10px;
                    vertical-align: middle;
                }
                @media (max-width: 767px) {
                    #header-user-management-btn {
                        display: none !important;
                    }
                }
            `;
            document.head.appendChild(style);
            
            return;
        } else {
            // Если у кнопки настроек нет родителя, создаем контейнер для обеих кнопок
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.top = '20px';
            container.style.right = '20px';
            container.style.zIndex = '1000';
            container.style.display = 'flex';
            container.style.gap = '10px';
            
            // Клонируем кнопку настроек
            const settingsClone = settingsButton.cloneNode(true);
            
            // Добавляем кнопки в контейнер
            container.appendChild(settingsClone);
            container.appendChild(userManagementBtn);
            
            // Добавляем контейнер на страницу
            document.body.appendChild(container);
            
            // Скрываем оригинальную кнопку настроек
            settingsButton.style.visibility = 'hidden';
            
            // Добавляем обработчик клика на клонированную кнопку настроек
            settingsClone.addEventListener('click', function() {
                // Имитируем клик на оригинальную кнопку
                settingsButton.click();
            });
            
            return;
        }
    }
    
    // Если кнопка настроек не найдена, используем стандартное размещение в шапке
    const header = document.querySelector('header') || document.querySelector('.header');
    
    if (!header) {
        // Если шапка не найдена, создаем её
        const body = document.body;
        const mainContent = document.querySelector('main') || document.querySelector('.content') || body.firstChild;
        
        const newHeader = document.createElement('header');
        newHeader.className = 'site-header';
        newHeader.style.display = 'flex';
        newHeader.style.justifyContent = 'flex-end';
        newHeader.style.padding = '10px 20px';
        newHeader.style.backgroundColor = '#1e1e2d';
        newHeader.style.borderBottom = '1px solid #2d2d3f';
        newHeader.style.position = 'sticky';
        newHeader.style.top = '0';
        newHeader.style.zIndex = '100';
        
        body.insertBefore(newHeader, mainContent);
        
        // Используем созданную шапку
        addButtonToHeader(newHeader);
    } else {
        // Используем существующую шапку
        addButtonToHeader(header);
    }
    
    // Добавляем медиа-запрос для скрытия кнопки на мобильных устройствах
    const style = document.createElement('style');
    style.textContent = `
        @media (max-width: 767px) {
            #header-user-management-btn {
                display: none !important;
            }
        }
    `;
    document.head.appendChild(style);
}

// Функция для создания кнопки управления пользователями
function createUserManagementButton() {
    const userManagementBtn = document.createElement('button');
    userManagementBtn.id = 'header-user-management-btn';
    userManagementBtn.className = 'admin-header-btn';
    userManagementBtn.innerHTML = '<i class="fas fa-users"></i>';
    userManagementBtn.style.backgroundColor = '#3498db';
    userManagementBtn.style.color = 'white';
    userManagementBtn.style.padding = '12px';
    userManagementBtn.style.borderRadius = '50%';
    userManagementBtn.style.border = 'none';
    userManagementBtn.style.cursor = 'pointer';
    userManagementBtn.style.display = 'flex';
    userManagementBtn.style.alignItems = 'center';
    userManagementBtn.style.justifyContent = 'center';
    userManagementBtn.style.fontWeight = 'bold';
    userManagementBtn.style.fontSize = '16px';
    userManagementBtn.style.width = '45px';
    userManagementBtn.style.height = '45px';
    userManagementBtn.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.16)';
    userManagementBtn.style.transition = 'all 0.3s ease';
    userManagementBtn.title = 'Управление пользователями';
    
    // Добавляем эффект при наведении
    userManagementBtn.onmouseover = function() {
        this.style.backgroundColor = '#2980b9';
        this.style.transform = 'translateY(-3px)';
        this.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.2)';
    };
    userManagementBtn.onmouseout = function() {
        this.style.backgroundColor = '#3498db';
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.16)';
    };
    
    userManagementBtn.addEventListener('click', () => {
        try {
            showUserManagementPanel();
        } catch (error) {
            console.error('Ошибка при открытии панели управления пользователями:', error);
            showNotification('Ошибка при открытии панели управления пользователями', 'error');
        }
    });
    
    return userManagementBtn;
}

// Вспомогательная функция для добавления кнопки в шапку
function addButtonToHeader(header) {
    const userManagementBtn = createUserManagementButton();
    userManagementBtn.style.marginLeft = 'auto';
    header.appendChild(userManagementBtn);
}

// Функция для обновления статуса администратора
function updateAdminStatus() {
    if (isAdmin && window.innerWidth >= 768) {
        addUserManagementButton();
    }
}

// Показать админ-панель
function showAdminPanel() {
    adminPanel.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Запрет прокрутки основной страницы
    
    // Анимация появления
    const adminContent = document.querySelector('.admin-content');
    adminContent.style.opacity = '0';
    adminContent.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
        adminContent.style.opacity = '1';
        adminContent.style.transform = 'translateY(0)';
    }, 10);
}

// Проверка пароля
function checkPassword() {
    const password = passwordInput.value;
    
    if (password === ADMIN_PASSWORD) {
        isAdmin = true;
        localStorage.setItem('adminToken', 'true');
        loginBtn.innerHTML = '<i class="fas fa-cog"></i><span class="btn-text">Админ панель</span>';
        loginBtn.title = 'Админ панель';
        loginModal.classList.add('hidden');
        passwordInput.value = '';
        loginError.classList.add('hidden');
        
        // Перезагружаем страницу для обновления UI
        location.reload();
    } else {
        loginError.classList.remove('hidden');
        passwordInput.value = '';
        passwordInput.focus();
        
        // Анимация ошибки
        loginError.animate(
            [
                { transform: 'translateX(-5px)' },
                { transform: 'translateX(5px)' },
                { transform: 'translateX(-5px)' },
                { transform: 'translateX(5px)' },
                { transform: 'translateX(0)' }
            ],
            { duration: 300, iterations: 1 }
        );
    }
}

// Сохранение поста
async function savePost() {
    try {
    const title = postTitleInput.value.trim();
        const content = editor.root.innerHTML.trim();
        const password = postPasswordInput ? postPasswordInput.value.trim() : '';
    
    if (!title) {
            showNotification('Пожалуйста, введите заголовок публикации', 'error');
        postTitleInput.focus();
        return;
    }
    
        if (!content || content === '<p><br></p>') {
            showNotification('Пожалуйста, введите содержимое публикации', 'error');
        editor.focus();
        return;
    }
    
        // Добавляем анимацию загрузки
        savePostBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span class="btn-text">Сохранение...</span>';
        savePostBtn.disabled = true;
        
        if (currentPostId) {
            // Обновление существующего поста
            const { error } = await supabase
                .from('posts')
                .update({
                    title,
                    content,
                    password: password || null // Если пароль пустой, сохраняем как null
                })
                .eq('id', currentPostId);
                
            if (error) throw error;
            
            showNotification('Публикация успешно обновлена', 'success');
        } else {
            // Создание нового поста
            const { error } = await supabase
                .from('posts')
                .insert([
                    {
                        title,
                        content,
                        password: password || null // Если пароль пустой, сохраняем как null
        }
                ]);
        
            if (error) throw error;
        
            showNotification('Публикация успешно создана', 'success');
        }
        
        // Сбрасываем значения полей
        postTitleInput.value = '';
        editor.root.innerHTML = '';
        currentPostId = null;
        
        // Скрываем редактор
        editorContainer.classList.add('hidden');
        
        // Восстанавливаем кнопку
        savePostBtn.innerHTML = '<i class="fas fa-floppy-disk"></i><span class="btn-text">Сохранить</span>';
        savePostBtn.disabled = false;
        
        // Перезагружаем посты
        loadPosts();
    } catch (error) {
        console.error('Ошибка при сохранении публикации:', error);
        showNotification('Ошибка при сохранении публикации: ' + (error.message || 'Неизвестная ошибка'), 'error');
        
        // Восстанавливаем кнопку
        savePostBtn.innerHTML = '<i class="fas fa-floppy-disk"></i><span class="btn-text">Сохранить</span>';
        savePostBtn.disabled = false;
    }
}

// Показ уведомления
function showNotification(message, type = 'info') {
    // Удаляем предыдущее уведомление, если оно есть
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Создаем новое уведомление
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    // Добавляем иконку в зависимости от типа уведомления
    let icon;
    switch (type) {
        case 'success':
            icon = 'fas fa-check-circle';
            break;
        case 'error':
            icon = 'fas fa-exclamation-circle';
            break;
        default:
            icon = 'fas fa-info-circle';
    }
    
    notification.innerHTML = `<i class="${icon}"></i> ${message}`;
    
    // Добавляем уведомление на страницу
    document.body.appendChild(notification);
    
    // Показываем уведомление с анимацией
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Автоматически скрываем уведомление через 3 секунды
    setTimeout(() => {
        notification.classList.remove('show');
        
        // Удаляем элемент после завершения анимации
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// Редактирование поста
function editPost(post) {
    showAdminPanel();
    
    setTimeout(() => {
        editorContainer.classList.remove('hidden');
        
        // Загружаем данные поста в редактор
    currentPostId = post.id;
    postTitleInput.value = post.title;
    postPasswordInput.value = post.password || '';
    
        // Добавляем эффект загрузки
        editorContainer.classList.add('loading-editor');
    
        setTimeout(() => {
            editor.root.innerHTML = post.content;
            editorContainer.classList.remove('loading-editor');
    
            // Устанавливаем фокус на заголовок
    postTitleInput.focus();
        }, 300);
    }, 300);
}

// Удаление поста
async function deletePost(id) {
    try {
        // Показываем уведомление о процессе удаления
        showNotification('Удаление публикации...', 'info');
        
        const { error } = await supabase
            .from('posts')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        
        showNotification('Публикация успешно удалена', 'success');
        
        // Если мы находимся на странице статьи, перенаправляем на главную
        const urlParams = new URLSearchParams(window.location.search);
        const articleId = urlParams.get('id');
        
        if (articleId === id) {
            window.location.href = 'index.html';
        } else {
            // Иначе просто обновляем список постов
        loadPosts();
        }
    } catch (error) {
        console.error('Ошибка при удалении публикации:', error);
        showNotification('Ошибка при удалении публикации: ' + (error.message || 'Неизвестная ошибка'), 'error');
    }
}

// Предотвращение копирования и масштабирования
function preventCopyAndZoom() {
    // Предотвращение контекстного меню
    document.addEventListener('contextmenu', (e) => {
        if (isAdmin) return; // Разрешаем контекстное меню для админа
        
        // Разрешаем контекстное меню в редакторе и связанных элементах
        if (e.target.closest('.ql-editor') || 
            e.target.closest('.ql-toolbar') ||
            e.target.closest('#editor-container')) {
            return;
        }
        
        e.preventDefault();
    });
    
    // Предотвращение выделения текста
    document.addEventListener('selectstart', (e) => {
        if (isAdmin) return; // Разрешаем выделение для админа
        
        // Разрешаем выделение в полях ввода и редакторе
        if (e.target.tagName === 'INPUT' || 
            e.target.tagName === 'TEXTAREA' || 
            e.target.closest('.ql-editor') ||
            e.target.closest('.ql-toolbar') ||
            e.target.closest('#editor-container')) {
            return;
        }
        
        e.preventDefault();
    });
    
    // Предотвращение копирования текста
    document.addEventListener('copy', (e) => {
        if (isAdmin) return; // Разрешаем копирование для админа
        
        // Разрешаем копирование в редакторе и полях ввода
        if (e.target.tagName === 'INPUT' || 
            e.target.tagName === 'TEXTAREA' || 
            e.target.closest('.ql-editor') ||
            e.target.closest('#editor-container')) {
            return;
        }
        
        e.preventDefault();
    });
    
    // Предотвращение масштабирования на мобильных устройствах
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // Предотвращение масштабирования с помощью колесика мыши
    document.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }, { passive: false });
}

// Проверка соединения с базой данных
async function checkDatabaseConnection() {
    try {
        const { error } = await supabase.from('posts').select('count', { count: 'exact', head: true });
        
        if (error) {
            console.error('Ошибка подключения к базе данных:', error);
            showNotification('Ошибка подключения к базе данных: ' + (error.message || 'Неизвестная ошибка'), 'error');
        } else {
            console.log('Подключение к базе данных успешно установлено');
            // Проверяем существование таблицы комментариев
            checkCommentsTable();
        }
    } catch (error) {
        console.error('Ошибка при проверке подключения к базе данных:', error);
        showNotification('Ошибка подключения к базе данных: ' + (error.message || 'Неизвестная ошибка'), 'error');
    }
}

// Проверка существования таблицы комментариев
async function checkCommentsTable() {
    try {
        // Пытаемся выполнить запрос к таблице комментариев
        const { error } = await supabase.from('comments').select('count', { count: 'exact', head: true });
        
        if (error) {
            // Если таблица не существует, показываем уведомление
            if (error.code === '42P01') { // Код ошибки для "таблица не существует"
                console.error('Таблица комментариев не существует:', error);
                showNotification('Функция комментариев недоступна. Пожалуйста, создайте таблицу комментариев в базе данных.', 'error');
            } else {
                console.error('Ошибка при проверке таблицы комментариев:', error);
            }
        } else {
            console.log('Таблица комментариев существует и доступна');
        }
    } catch (error) {
        console.error('Ошибка при проверке таблицы комментариев:', error);
    }
}

// Обновление отображения имени автора в интерфейсе
function updateAuthorNameDisplay() {
    // Находим все элементы с классом comment-author и обновляем их
    const commentAuthors = document.querySelectorAll('.comment-author');
    commentAuthors.forEach(element => {
        if (authorName) {
            element.innerHTML = `<i class="fas fa-user"></i> <span>${authorName}</span>`;
        }
    });
    
    // Разблокируем кнопки отправки комментариев, если есть текст
    const submitCommentBtns = document.querySelectorAll('#submit-comment');
    submitCommentBtns.forEach(btn => {
        const commentTextarea = btn.closest('.comment-form').querySelector('#comment-text');
        if (commentTextarea) {
            btn.disabled = !commentTextarea.value.trim() || !authorName;
        }
    });
    
    console.log('Отображение имени автора обновлено:', authorName);
}

// Функция поиска
async function performSearch() {
    const query = searchInput.value.trim();
    
    if (!query) {
        showNotification('Введите поисковый запрос', 'error');
        return;
    }
    
    if (query.length < 2) {
        showNotification('Поисковый запрос должен содержать минимум 2 символа', 'error');
        return;
    }
    
    try {
        // Блокируем прокрутку страницы при открытии модального окна
        document.body.style.overflow = 'hidden';
        
        // Показываем модальное окно результатов поиска с индикатором загрузки
        searchResultsModal.classList.remove('hidden');
        searchQueryDisplay.textContent = `Поиск по запросу: "${query}"`;
        searchResultsContainer.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Выполняется поиск...</div>';
        noResultsDiv.classList.add('hidden');
        
        console.log('Выполняем поиск по запросу:', query);
        
        // Загружаем все посты для поиска
        const { data: posts, error } = await supabase
            .from('posts')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        if (!posts || posts.length === 0) {
            searchResultsContainer.innerHTML = '';
            noResultsDiv.classList.remove('hidden');
            return;
        }
        
        // Выполняем поиск по заголовкам и содержимому
        const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 1);
        
        // Оцениваем релевантность результатов
        const results = posts
            .map(post => {
                const title = post.title.toLowerCase();
                const content = stripHtml(post.content).toLowerCase();
                
                // Подсчитываем количество совпадений для каждого ключевого слова
                let relevance = 0;
                let matchesTitle = false;
                let matchesContent = false;
                
                keywords.forEach(keyword => {
                    // Совпадения в заголовке имеют больший вес
                    const titleMatches = (title.match(new RegExp(keyword, 'gi')) || []).length;
                    if (titleMatches > 0) {
                        matchesTitle = true;
                        relevance += titleMatches * 3; // Больший вес для заголовков
                    }
                    
                    // Совпадения в содержимом
                    const contentMatches = (content.match(new RegExp(keyword, 'gi')) || []).length;
                    if (contentMatches > 0) {
                        matchesContent = true;
                        relevance += contentMatches;
                    }
                });
                
                // Возвращаем пост с его релевантностью
                return {
                    post,
                    relevance,
                    matchesTitle,
                    matchesContent
                };
            })
            // Фильтруем результаты, где есть хотя бы одно совпадение
            .filter(item => item.relevance > 0)
            // Сортируем по релевантности
            .sort((a, b) => b.relevance - a.relevance);
        
        console.log(`Найдено ${results.length} результатов`);
        
        if (results.length === 0) {
            searchResultsContainer.innerHTML = '';
            noResultsDiv.classList.remove('hidden');
            return;
        }
        
        // Отображаем результаты
        let resultsHTML = '';
        
        results.forEach(({ post }) => {
            const date = new Date(post.created_at);
            const formattedDate = date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            
            const title = highlightKeywords(post.title, keywords);
            const content = createSnippet(post.content, keywords);
            
            resultsHTML += `
                <div class="search-result-item">
                    <div class="search-result-title">
                        <a href="index.html?id=${post.id}">${title}</a>
                    </div>
                    <div class="search-result-snippet">${content}</div>
                    <div class="search-result-date">
                        <i class="far fa-calendar-alt"></i> ${formattedDate}
                    </div>
                </div>
            `;
        });
        
        searchResultsContainer.innerHTML = resultsHTML;
        
        // Добавляем обработчики для результатов поиска
        document.querySelectorAll('.search-result-item a').forEach(link => {
            link.addEventListener('click', () => {
                // Закрываем модальное окно при клике на результат
                searchResultsModal.classList.add('hidden');
                document.body.style.overflow = 'auto';
            });
        });
        
    } catch (error) {
        console.error('Ошибка при поиске:', error);
        searchResultsContainer.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-circle"></i>
                <p>Произошла ошибка при поиске: ${error.message || 'Неизвестная ошибка'}</p>
            </div>
        `;
    }
}

// Удаление HTML тегов из текста
function stripHtml(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
}

// Подсветка ключевых слов в тексте
function highlightKeywords(text, keywords) {
    let result = text;
    // Сортируем ключевые слова по длине (от длинных к коротким)
    // чтобы избежать проблем с подсветкой вложенных слов
    const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);
    
    sortedKeywords.forEach(keyword => {
        if (keyword.length < 2) return; // Пропускаем слишком короткие слова
        
        const regex = new RegExp(escapeRegExp(keyword), 'gi');
        result = result.replace(regex, match => `<span class="search-highlight">${match}</span>`);
    });
    return result;
}

// Экранирование специальных символов для регулярных выражений
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Создание сниппета текста с подсветкой ключевых слов
function createSnippet(html, keywords) {
    const text = stripHtml(html);
    const maxLength = 200;
    
    // Ищем первое вхождение любого ключевого слова
    let firstIndex = -1;
    let matchedKeyword = '';
    
    keywords.forEach(keyword => {
        if (keyword.length < 2) return; // Пропускаем слишком короткие слова
        
        const index = text.toLowerCase().indexOf(keyword.toLowerCase());
        if (index !== -1 && (firstIndex === -1 || index < firstIndex)) {
            firstIndex = index;
            matchedKeyword = keyword;
        }
    });
    
    // Если ключевое слово не найдено, берем начало текста
    if (firstIndex === -1) {
        return highlightKeywords(text.substring(0, maxLength) + '...', keywords);
    }
    
    // Определяем начало и конец сниппета
    let start = Math.max(0, firstIndex - 60);
    let end = Math.min(text.length, firstIndex + matchedKeyword.length + 140);
    
    // Добавляем многоточие в начале и конце, если нужно
    let snippet = '';
    if (start > 0) snippet += '...';
    snippet += text.substring(start, end);
    if (end < text.length) snippet += '...';
    
    return highlightKeywords(snippet, keywords);
}

// Функция предпросмотра изображения
function previewImage() {
    const url = imageUrlInput.value.trim();
    
    if (!url) {
        imageUrlError.textContent = 'Пожалуйста, введите URL изображения';
        imageUrlError.classList.remove('hidden');
        return;
    }
    
    // Создаем изображение для проверки загрузки
    const img = new Image();
    
    // Показываем индикатор загрузки
    imagePreview.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Загрузка изображения...</div>';
    imagePreviewContainer.classList.remove('hidden');
    imageUrlError.classList.add('hidden');
    
    // Обработчик успешной загрузки
    img.onload = function() {
        imagePreview.innerHTML = '';
        imagePreview.appendChild(img);
        insertImageBtn.disabled = false;
    };
    
    // Обработчик ошибки загрузки
    img.onerror = function() {
        imagePreview.innerHTML = '';
        imageUrlError.textContent = 'Не удалось загрузить изображение. Проверьте URL.';
        imageUrlError.classList.remove('hidden');
        insertImageBtn.disabled = true;
    };
    
    // Устанавливаем источник изображения
    img.src = url;
}

// Функция вставки изображения в редактор
function insertImage() {
    const url = imageUrlInput.value.trim();
    
    if (url && imageInsertRange) {
        editor.insertEmbed(imageInsertRange.index, 'image', url);
        
        // Закрываем модальное окно
        imageUrlModal.classList.add('hidden');
        
        // Устанавливаем фокус обратно на редактор
        setTimeout(() => {
            editor.focus();
        }, 100);
        
        // Показываем уведомление
        showNotification('Изображение успешно вставлено', 'success');
    }
} 

// Функция для обработки видео в содержимом статьи
function processVideosInContent(contentElement) {
    if (!contentElement) return;
    
    // Находим все элементы видео
    const videoElements = contentElement.querySelectorAll('.ql-video');
    
    videoElements.forEach(video => {
        const videoUrl = video.getAttribute('src');
        if (videoUrl) {
            // Обрабатываем URL видео
            const { videoHtml } = processVideoUrl(videoUrl);
            
            if (videoHtml) {
                // Создаем контейнер для видео
                const videoContainer = document.createElement('div');
                videoContainer.classList.add('ql-video-container');
                videoContainer.innerHTML = videoHtml;
                
                // Заменяем оригинальный элемент видео на контейнер с iframe
                if (video.parentNode) {
                    video.parentNode.replaceChild(videoContainer, video);
                }
            }
        }
    });
}

// Функция для отображения фотографии в полноэкранном режиме
function showLightbox(imageUrl) {
    // Создаем элементы лайтбокса
    const lightbox = document.createElement('div');
    lightbox.classList.add('lightbox');
    
    const lightboxContent = document.createElement('div');
    lightboxContent.classList.add('lightbox-content');
    
    const closeBtn = document.createElement('button');
    closeBtn.classList.add('lightbox-close');
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = 'Полноэкранный просмотр';
    
    // Собираем структуру
    lightboxContent.appendChild(closeBtn);
    lightboxContent.appendChild(image);
    lightbox.appendChild(lightboxContent);
    
    // Добавляем на страницу
    document.body.appendChild(lightbox);
    
    // Блокируем прокрутку страницы
    document.body.style.overflow = 'hidden';
    
    // Добавляем анимацию появления
    setTimeout(() => {
        lightbox.classList.add('active');
    }, 10);
    
    // Обработчик закрытия по клику на кнопку
    closeBtn.addEventListener('click', closeLightbox);
    
    // Обработчик закрытия по клику на фон
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });
    
    // Обработчик закрытия по клавише Esc
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            closeLightbox();
        }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    // Функция закрытия лайтбокса
    function closeLightbox() {
        lightbox.classList.remove('active');
        
        // Удаляем элемент после анимации
        setTimeout(() => {
            document.body.removeChild(lightbox);
            document.body.style.overflow = 'auto';
            document.removeEventListener('keydown', handleKeyDown);
        }, 300);
    }
}

// Проверка и создание хранилища для фотографий
async function checkStorageBucket() {
    try {
        console.log('Проверка хранилища для фотографий...');
        
        // Проверяем, существует ли хранилище
        const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
        
        if (bucketsError) {
            console.error('Ошибка при проверке хранилища:', bucketsError);
            // Не показываем уведомление об ошибке
            return;
        }
        
        // Проверяем, существует ли бакет 'comments-photos'
        const photosBucket = buckets.find(bucket => bucket.name === 'comments-photos');
        
        if (!photosBucket) {
            console.log('Хранилище "comments-photos" не существует.');
            // Не показываем уведомление об ошибке
        } else {
            console.log('Хранилище "comments-photos" существует');
        }
    } catch (error) {
        console.error('Ошибка при проверке хранилища:', error);
        // Не показываем уведомление об ошибке
    }
}

// Функция для удаления комментария
async function deleteComment(commentId, postId) {
    try {
        console.log('Удаление комментария с ID:', commentId);
        
        // Проверяем, является ли пользователь администратором
        if (!isAdmin) {
            console.error('Попытка удаления комментария без прав администратора');
            showNotification('У вас нет прав для удаления комментариев', 'error');
            return;
        }
        
        // Показываем уведомление о процессе
        showNotification('Удаление комментария...', 'info');
        
        // Получаем данные комментария для удаления фотографий
        const { data: comment, error: commentError } = await supabase
            .from('comments')
            .select('*')
            .eq('id', commentId)
            .single();
            
        if (commentError) {
            console.error('Ошибка при получении данных комментария:', commentError);
            showNotification('Ошибка при удалении комментария', 'error');
            return;
        }
        
        // Удаляем фотографии из хранилища, если они есть
        if (comment && comment.photos && comment.photos.length > 0) {
            console.log(`Найдено ${comment.photos.length} фотографий для удаления`);
            
            // Собираем пути к фотографиям
            const photoPaths = [];
            comment.photos.forEach(photo => {
                if (photo.url) {
                    // Извлекаем путь к файлу из URL
                    const url = new URL(photo.url);
                    const pathMatch = url.pathname.match(/\/comments-photos\/storage\/v1\/object\/public\/comments-photos\/(.+)$/);
                    if (pathMatch && pathMatch[1]) {
                        photoPaths.push(pathMatch[1]);
                    }
                }
            });
            
            // Удаляем фотографии из хранилища
            if (photoPaths.length > 0) {
                console.log(`Удаление ${photoPaths.length} фотографий из хранилища`);
                const { error: deletePhotosError } = await supabase.storage
                    .from('comments-photos')
                    .remove(photoPaths);
                    
                if (deletePhotosError) {
                    console.error('Ошибка при удалении фотографий:', deletePhotosError);
                    // Продолжаем выполнение, так как основная задача - удаление комментария
                } else {
                    console.log('Фотографии успешно удалены');
                }
            }
        }
        
        // Удаляем комментарий из базы данных
        const { error } = await supabase
            .from('comments')
            .delete()
            .eq('id', commentId);
            
        if (error) {
            console.error('Ошибка при удалении комментария:', error);
            showNotification('Ошибка при удалении комментария', 'error');
            return;
        }
        
        // Показываем уведомление об успешном удалении
        showNotification('Комментарий успешно удален', 'success');
        
        // Перезагружаем комментарии
        loadComments(postId);
    } catch (error) {
        console.error('Ошибка при удалении комментария:', error);
        showNotification('Ошибка при удалении комментария', 'error');
    }
}

// Функция для отображения панели управления пользователями
function showUserManagementPanel() {
    // Проверяем, что пользователь является администратором
    if (!isAdmin) {
        showNotification('У вас нет прав для управления пользователями', 'error');
        return;
    }
    
    // Создаем панель управления пользователями, если она еще не существует
    let userManagementPanel = document.getElementById('user-management-panel');
    
    if (!userManagementPanel) {
        userManagementPanel = document.createElement('div');
        userManagementPanel.id = 'user-management-panel';
        userManagementPanel.classList.add('admin-panel');
        userManagementPanel.style.position = 'fixed';
        userManagementPanel.style.top = '50%';
        userManagementPanel.style.left = '50%';
        userManagementPanel.style.transform = 'translate(-50%, -50%)';
        userManagementPanel.style.backgroundColor = '#1e1e2d';
        userManagementPanel.style.color = 'white';
        userManagementPanel.style.borderRadius = '10px';
        userManagementPanel.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
        userManagementPanel.style.zIndex = '1000';
        userManagementPanel.style.width = '90%';
        userManagementPanel.style.maxWidth = '1000px';
        userManagementPanel.style.maxHeight = '80vh';
        userManagementPanel.style.display = 'flex';
        userManagementPanel.style.flexDirection = 'column';
        
        userManagementPanel.innerHTML = `
            <div class="panel-header" style="padding: 15px; border-bottom: 1px solid #2d2d3f; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 20px;">Управление пользователями</h2>
                <button id="close-user-management" class="close-btn" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer;"><i class="fas fa-times"></i></button>
            </div>
            <div class="panel-content" style="padding: 15px; overflow-y: auto; flex-grow: 1;">
                <div class="search-users" style="display: flex; margin-bottom: 20px;">
                    <input type="text" id="user-search" placeholder="Поиск по имени или IP..." style="flex: 1; padding: 10px; border: 1px solid #2d2d3f; border-radius: 5px 0 0 5px; background-color: #2d2d3f; color: white;">
                    <button id="search-users-btn" style="padding: 10px 15px; background-color: #3498db; color: white; border: none; border-radius: 0 5px 5px 0; cursor: pointer;"><i class="fas fa-search"></i></button>
                </div>
                <div class="users-list-container" style="max-height: 500px; overflow-y: auto; border-radius: 5px; background-color: #2d2d3f;">
                    <table class="users-table" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                        <thead>
                            <tr style="background-color: #3a3a4c;">
                                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 5%;">ID</th>
                                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 20%;">Имя</th>
                                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 20%;">IP адрес</th>
                                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 15%;">Статус</th>
                                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 15%;">Дата регистрации</th>
                                <th style="padding: 12px; text-align: center; border-bottom: 1px solid #4a4a5a; width: 12.5%;">Редактировать</th>
                                <th style="padding: 12px; text-align: center; border-bottom: 1px solid #4a4a5a; width: 12.5%;">Блокировка</th>
                            </tr>
                        </thead>
                        <tbody id="users-list">
                            <tr>
                                <td colspan="8" style="text-align: center; padding: 20px;">Загрузка пользователей...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div class="pagination" id="users-pagination" style="display: flex; justify-content: center; align-items: center; margin-top: 15px;">
                    <button id="prev-users-page" style="padding: 8px 12px; background-color: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px;"><i class="fas fa-chevron-left"></i></button>
                    <span style="margin: 0 10px;"><span id="current-users-page">1</span> из <span id="total-users-pages">1</span></span>
                    <button id="next-users-page" style="padding: 8px 12px; background-color: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;"><i class="fas fa-chevron-right"></i></button>
                </div>
            </div>
        `;
        
        document.body.appendChild(userManagementPanel);
        
        // Добавляем обработчики событий
        document.getElementById('close-user-management').addEventListener('click', () => {
            userManagementPanel.style.display = 'none';
        });
        
        document.getElementById('search-users-btn').addEventListener('click', () => {
            const searchQuery = document.getElementById('user-search').value.trim();
            loadUsers(1, searchQuery);
        });
        
        document.getElementById('user-search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const searchQuery = document.getElementById('user-search').value.trim();
                loadUsers(1, searchQuery);
            }
        });
        
        document.getElementById('prev-users-page').addEventListener('click', () => {
            const currentPage = parseInt(document.getElementById('current-users-page').textContent);
            if (currentPage > 1) {
                const searchQuery = document.getElementById('user-search').value.trim();
                loadUsers(currentPage - 1, searchQuery);
            }
        });
        
        document.getElementById('next-users-page').addEventListener('click', () => {
            const currentPage = parseInt(document.getElementById('current-users-page').textContent);
            const totalPages = parseInt(document.getElementById('total-users-pages').textContent);
            if (currentPage < totalPages) {
                const searchQuery = document.getElementById('user-search').value.trim();
                loadUsers(currentPage + 1, searchQuery);
            }
        });
        
        // Добавляем стили для кнопок блокировки/разблокировки
        const style = document.createElement('style');
        style.textContent = `
            .user-blocked {
                background-color: rgba(244, 67, 54, 0.1);
            }
            
            .block-btn {
                background-color: #f44336;
                color: white;
                border: none;
                padding: 5px 10px;
                border-radius: 3px;
                cursor: pointer;
                transition: background-color 0.3s;
                display: inline-block;
                text-align: center;
                width: 100%;
                max-width: 120px;
            }
            
            .block-btn:hover {
                background-color: #d32f2f;
            }
            
            .unblock-btn {
                background-color: #4CAF50;
                color: white;
                border: none;
                padding: 5px 10px;
                border-radius: 3px;
                cursor: pointer;
                transition: background-color 0.3s;
                display: inline-block;
                text-align: center;
                width: 100%;
                max-width: 120px;
            }
            
            .unblock-btn:hover {
                background-color: #388e3c;
            }
            
            .edit-username-btn {
                background-color: #f39c12;
                color: white;
                border: none;
                padding: 5px 10px;
                border-radius: 3px;
                cursor: pointer;
                transition: background-color 0.3s;
                display: inline-block;
                text-align: center;
                width: 100%;
                max-width: 120px;
            }
            
            .edit-username-btn:hover {
                background-color: #e67e22;
            }
            
            .delete-user-btn {
                background-color: #e74c3c;
                color: white;
                border: none;
                padding: 5px 10px;
                border-radius: 3px;
                cursor: pointer;
                transition: background-color 0.3s;
                display: inline-block;
                text-align: center;
                width: 100%;
                max-width: 120px;
            }
            
            .delete-user-btn:hover {
                background-color: #c0392b;
            }
            
            #user-management-panel .users-table tr:hover {
                background-color: #3a3a4c;
            }
            
            #user-management-panel .users-table td {
                padding: 10px;
                border-bottom: 1px solid #4a4a5a;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            #user-management-panel .users-table td:last-child {
                text-align: center;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Показываем панель
    userManagementPanel.style.display = 'flex';
    
    // Загружаем пользователей
    loadUsers(1);
}

// Функция для загрузки пользователей
async function loadUsers(page = 1, searchQuery = '') {
    try {
        const usersPerPage = 10;
        const usersList = document.getElementById('users-list');
        const currentUsersPage = document.getElementById('current-users-page');
        const totalUsersPages = document.getElementById('total-users-pages');
        
        if (!usersList) {
            console.error('Элемент списка пользователей не найден');
            return;
        }
        
        // Показываем индикатор загрузки
        usersList.innerHTML = '<tr><td colspan="8" class="loading-users" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin" style="margin-right: 10px;"></i>Загрузка пользователей...</td></tr>';
        
        // Проверяем существование таблицы users
        const { error: tableCheckError } = await supabase
            .from('users')
            .select('id')
            .limit(1);
            
        if (tableCheckError) {
            console.error('Ошибка при проверке таблицы users:', tableCheckError);
            
            // Если таблица не существует, создаем её
            if (tableCheckError.message.includes('does not exist')) {
                usersList.innerHTML = '<tr><td colspan="8" class="loading-users" style="text-align: center; padding: 20px;"><i class="fas fa-database" style="margin-right: 10px;"></i>Таблица пользователей не существует. Создаем...</td></tr>';
                
                // Создаем таблицу users
                const { error: createTableError } = await supabase.rpc('exec', { 
                    sql: `
                    CREATE TABLE IF NOT EXISTS public.users (
                        id SERIAL PRIMARY KEY,
                        ip_address TEXT NOT NULL UNIQUE,
                        username TEXT NOT NULL,
                        is_blocked BOOLEAN DEFAULT FALSE,
                        block_reason TEXT,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                    `
                });
                
                if (createTableError) {
                    console.error('Ошибка при создании таблицы users:', createTableError);
                    usersList.innerHTML = '<tr><td colspan="8" class="loading-users" style="text-align: center; padding: 20px; color: #f44336;"><i class="fas fa-exclamation-triangle" style="margin-right: 10px;"></i>Ошибка при создании таблицы пользователей. Обратитесь к администратору.</td></tr>';
                    return;
                }
                
                // Создаем индекс для ip_address
                await supabase.rpc('exec', { 
                    sql: 'CREATE INDEX IF NOT EXISTS users_ip_address_idx ON public.users (ip_address)'
                });
                
                usersList.innerHTML = '<tr><td colspan="8" class="loading-users" style="text-align: center; padding: 20px; color: #4CAF50;"><i class="fas fa-check-circle" style="margin-right: 10px;"></i>Таблица пользователей успешно создана. Пользователей пока нет.</td></tr>';
                return;
            }
            
            usersList.innerHTML = '<tr><td colspan="8" class="loading-users" style="text-align: center; padding: 20px; color: #f44336;"><i class="fas fa-exclamation-triangle" style="margin-right: 10px;"></i>Ошибка при загрузке пользователей</td></tr>';
            return;
        }
        
        // Формируем запрос
        let query = supabase
            .from('users')
            .select('*', { count: 'exact' });
        
        // Добавляем поиск, если указан
        if (searchQuery) {
            query = query.or(`username.ilike.%${searchQuery}%,ip_address.ilike.%${searchQuery}%`);
        }
        
        // Добавляем пагинацию
        const from = (page - 1) * usersPerPage;
        const to = from + usersPerPage - 1;
        
        // Выполняем запрос
        const { data: users, error, count } = await query
            .order('created_at', { ascending: false })
            .range(from, to);
        
        if (error) {
            console.error('Ошибка при загрузке пользователей:', error);
            usersList.innerHTML = '<tr><td colspan="8" class="loading-users" style="text-align: center; padding: 20px; color: #f44336;"><i class="fas fa-exclamation-triangle" style="margin-right: 10px;"></i>Ошибка при загрузке пользователей</td></tr>';
            return;
        }
        
        // Обновляем пагинацию
        const totalPages = Math.ceil((count || 0) / usersPerPage);
        currentUsersPage.textContent = page;
        totalUsersPages.textContent = totalPages || 1;
        
        // Обновляем заголовок таблицы, добавляя столбец для кнопки редактирования
                        const tableHeader = document.querySelector('.users-table thead tr');
                if (tableHeader) {
                    tableHeader.innerHTML = `
                        <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 5%;">ID</th>
                        <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 15%;">Имя</th>
                        <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 20%;">IP адрес</th>
                        <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 10%;">Статус</th>
                        <th style="padding: 12px; text-align: left; border-bottom: 1px solid #4a4a5a; width: 15%;">Дата регистрации</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 1px solid #4a4a5a; width: 10%;">Редактировать</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 1px solid #4a4a5a; width: 10%;">Блокировка</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 1px solid #4a4a5a; width: 15%;">Удалить</th>
                    `;
        }
        
        // Отображаем пользователей
        if (users && users.length > 0) {
            usersList.innerHTML = '';
            
            // Проверяем, есть ли текущий IP пользователя в списке
            const currentUserIPExists = users.some(user => user.ip_address === userIP);
            
            // Если IP текущего пользователя не найден в текущей странице, добавляем его в начало списка
            if (!currentUserIPExists && userIP) {
                // Получаем информацию о текущем пользователе
                const { data: currentUserData, error: currentUserError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('ip_address', userIP)
                    .single();
                
                if (currentUserData && !currentUserError) {
                    // Добавляем текущего пользователя в начало списка с выделением
                    const currentUserRow = document.createElement('tr');
                    currentUserRow.style.backgroundColor = 'rgba(52, 152, 219, 0.1)';
                    currentUserRow.style.fontWeight = 'bold';
                    
                    if (currentUserData.is_blocked) {
                        currentUserRow.classList.add('user-blocked');
                    }
                    
                    const createdAt = new Date(currentUserData.created_at).toLocaleString();
                    
                    currentUserRow.innerHTML = `
                        <td>${currentUserData.id}</td>
                        <td>${currentUserData.username}</td>
                        <td>${currentUserData.ip_address} <span style="color: #3498db; font-size: 12px;">(Вы)</span></td>
                        <td>${currentUserData.is_blocked ? '<span style="color: red;">Заблокирован</span>' : '<span style="color: green;">Активен</span>'}</td>
                        <td>${createdAt}</td>
                        <td>
                            <button class="edit-username-btn" data-id="${currentUserData.id}" title="Редактировать имя" style="background-color: #f39c12; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: background-color 0.3s; display: inline-block; text-align: center; width: 100%; max-width: 120px;">
                                <i class="fas fa-edit"></i> Имя
                            </button>
                        </td>
                        <td>
                            ${currentUserData.is_blocked ? 
                                `<button class="unblock-btn" data-id="${currentUserData.id}">Разблокировать</button>` : 
                                `<button class="block-btn" data-id="${currentUserData.id}">Заблокировать</button>`
                            }
                        </td>
                        <td>
                            <button class="delete-user-btn" data-id="${currentUserData.id}" title="Удалить пользователя" style="background-color: #e74c3c; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: background-color 0.3s; display: inline-block; text-align: center; width: 100%; max-width: 120px;">
                                <i class="fas fa-trash-alt"></i> Удалить
                            </button>
                        </td>
                    `;
                    
                    usersList.appendChild(currentUserRow);
                }
            }
            
            // Отображаем остальных пользователей
            users.forEach(user => {
                // Пропускаем текущего пользователя, если он уже был добавлен
                if (user.ip_address === userIP && !currentUserIPExists) return;
                
                const row = document.createElement('tr');
                if (user.is_blocked) {
                    row.classList.add('user-blocked');
                }
                
                const createdAt = new Date(user.created_at).toLocaleString();
                const isCurrentUser = user.ip_address === userIP;
                
                row.innerHTML = `
                    <td>${user.id}</td>
                    <td>${user.username}</td>
                    <td>${user.ip_address}${isCurrentUser ? ' <span style="color: #3498db; font-size: 12px;">(Вы)</span>' : ''}</td>
                    <td>${user.is_blocked ? '<span style="color: red;">Заблокирован</span>' : '<span style="color: green;">Активен</span>'}</td>
                    <td>${createdAt}</td>
                    <td>
                        <button class="edit-username-btn" data-id="${user.id}" title="Редактировать имя" style="background-color: #f39c12; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: background-color 0.3s; display: inline-block; text-align: center; width: 100%; max-width: 120px;">
                            <i class="fas fa-edit"></i> Имя
                        </button>
                    </td>
                    <td>
                        ${user.is_blocked ? 
                            `<button class="unblock-btn" data-id="${user.id}">Разблокировать</button>` : 
                            `<button class="block-btn" data-id="${user.id}">Заблокировать</button>`
                        }
                    </td>
                    <td>
                        <button class="delete-user-btn" data-id="${user.id}" title="Удалить пользователя" style="background-color: #e74c3c; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; transition: background-color 0.3s; display: inline-block; text-align: center; width: 100%; max-width: 120px;">
                            <i class="fas fa-trash-alt"></i> Удалить
                        </button>
                    </td>
                `;
                
                usersList.appendChild(row);
            });
            
            // Добавляем обработчики для кнопок блокировки/разблокировки
            document.querySelectorAll('.block-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    showBlockUserModal(btn.dataset.id);
                });
            });
            
            document.querySelectorAll('.unblock-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    unblockUser(btn.dataset.id);
                });
            });
            
            // Добавляем обработчики для кнопок редактирования имени
            document.querySelectorAll('.edit-username-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    showEditUsernameModal(btn.dataset.id);
                });
                
                // Добавляем эффект при наведении
                btn.addEventListener('mouseover', function() {
                    this.style.backgroundColor = '#e67e22';
                });
                
                btn.addEventListener('mouseout', function() {
                    this.style.backgroundColor = '#f39c12';
                });
            });
            
            // Добавляем обработчики для кнопок удаления пользователя
            document.querySelectorAll('.delete-user-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    showDeleteUserModal(btn.dataset.id);
                });
                
                // Добавляем эффект при наведении
                btn.addEventListener('mouseover', function() {
                    this.style.backgroundColor = '#c0392b';
                });
                
                btn.addEventListener('mouseout', function() {
                    this.style.backgroundColor = '#e74c3c';
                });
            });
        } else {
                          usersList.innerHTML = '<tr><td colspan="8" class="loading-users" style="text-align: center; padding: 20px;"><i class="fas fa-user-slash" style="margin-right: 10px;"></i>Пользователи не найдены</td></tr>';
        }
    } catch (error) {
        console.error('Ошибка при загрузке пользователей:', error);
        const usersList = document.getElementById('users-list');
        if (usersList) {
            usersList.innerHTML = '<tr><td colspan="8" class="loading-users" style="text-align: center; padding: 20px; color: #f44336;"><i class="fas fa-exclamation-triangle" style="margin-right: 10px;"></i>Ошибка при загрузке пользователей</td></tr>';
        }
    }
}

// Функция для отображения модального окна блокировки пользователя
function showBlockUserModal(userId) {
    // Создаем модальное окно для блокировки пользователя
    const blockUserModal = document.createElement('div');
    blockUserModal.classList.add('modal');
    blockUserModal.id = 'block-user-modal';
    blockUserModal.style.position = 'fixed';
    blockUserModal.style.top = '0';
    blockUserModal.style.left = '0';
    blockUserModal.style.width = '100%';
    blockUserModal.style.height = '100%';
    blockUserModal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    blockUserModal.style.display = 'flex';
    blockUserModal.style.justifyContent = 'center';
    blockUserModal.style.alignItems = 'center';
    blockUserModal.style.zIndex = '1001';
    
    blockUserModal.innerHTML = `
        <div class="modal-content" style="background-color: #1e1e2d; color: white; border-radius: 10px; width: 90%; max-width: 500px; box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);">
            <div class="modal-header" style="padding: 15px; border-bottom: 1px solid #2d2d3f; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 20px;">Блокировка пользователя</h2>
                <span class="close" style="font-size: 24px; cursor: pointer;">&times;</span>
            </div>
            <div class="modal-body" style="padding: 20px;">
                <p style="margin-top: 0;">Укажите причину блокировки:</p>
                <textarea id="block-reason" placeholder="Причина блокировки" rows="3" style="width: 100%; padding: 10px; border: 1px solid #2d2d3f; border-radius: 5px; background-color: #2d2d3f; color: white; resize: vertical;"></textarea>
                <div id="block-error" class="error hidden" style="color: #f44336; margin-top: 10px; display: none;"></div>
            </div>
            <div class="modal-footer" style="padding: 15px; border-top: 1px solid #2d2d3f; display: flex; justify-content: flex-end;">
                <button id="cancel-block-btn" class="cancel-btn" style="padding: 8px 15px; background-color: #4a4a5a; color: white; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px;">Отмена</button>
                <button id="confirm-block-btn" class="primary-btn" style="padding: 8px 15px; background-color: #f44336; color: white; border: none; border-radius: 5px; cursor: pointer;">Заблокировать</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(blockUserModal);
    
    // Показываем модальное окно с анимацией
    setTimeout(() => {
        const modalContent = blockUserModal.querySelector('.modal-content');
        modalContent.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
        modalContent.style.transform = 'translateY(0)';
        modalContent.style.opacity = '1';
    }, 10);
    
    // Добавляем обработчики событий
    const closeBtn = blockUserModal.querySelector('.close');
    const cancelBtn = document.getElementById('cancel-block-btn');
    const confirmBtn = document.getElementById('confirm-block-btn');
    
    // Функция закрытия модального окна
    const closeModal = () => {
        const modalContent = blockUserModal.querySelector('.modal-content');
        modalContent.style.transform = 'translateY(-20px)';
        modalContent.style.opacity = '0';
        
        setTimeout(() => {
            blockUserModal.remove();
        }, 300);
    };
    
    closeBtn.addEventListener('click', closeModal);
    
    cancelBtn.addEventListener('click', closeModal);
    
    confirmBtn.addEventListener('click', async () => {
        const reason = document.getElementById('block-reason').value.trim();
        const blockError = document.getElementById('block-error');
        
        if (!reason) {
            blockError.textContent = 'Пожалуйста, укажите причину блокировки';
            blockError.style.display = 'block';
            return;
        }
        
        // Блокируем кнопку на время выполнения запроса
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Блокировка...';
        
        try {
            // Блокируем пользователя
            await blockUser(userId, reason);
            
            // Закрываем модальное окно
            closeModal();
        } catch (error) {
            console.error('Ошибка при блокировке пользователя:', error);
            blockError.textContent = 'Ошибка при блокировке пользователя';
            blockError.style.display = 'block';
            
            // Разблокируем кнопку
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Заблокировать';
        }
    });
    
    // Устанавливаем начальные стили для анимации
    const modalContent = blockUserModal.querySelector('.modal-content');
    modalContent.style.transform = 'translateY(-20px)';
    modalContent.style.opacity = '0';
}

// Функция для блокировки пользователя
async function blockUser(userId, reason) {
    try {
        const { error } = await supabase
            .from('users')
            .update({
                is_blocked: true,
                block_reason: reason,
                updated_at: new Date()
            })
            .eq('id', userId);
            
        if (error) {
            console.error('Ошибка при блокировке пользователя:', error);
            showNotification('Ошибка при блокировке пользователя', 'error');
            return;
        }
        
        showNotification('Пользователь успешно заблокирован', 'success');
        
        // Перезагружаем список пользователей
        const currentPage = parseInt(document.getElementById('current-users-page').textContent);
        const searchQuery = document.getElementById('user-search')?.value.trim() || '';
        loadUsers(currentPage, searchQuery);
    } catch (error) {
        console.error('Ошибка при блокировке пользователя:', error);
        showNotification('Ошибка при блокировке пользователя', 'error');
    }
}

// Функция для разблокировки пользователя
async function unblockUser(userId) {
    try {
        const { error } = await supabase
            .from('users')
            .update({
                is_blocked: false,
                block_reason: null,
                updated_at: new Date()
            })
            .eq('id', userId);
            
        if (error) {
            console.error('Ошибка при разблокировке пользователя:', error);
            showNotification('Ошибка при разблокировке пользователя', 'error');
            return;
        }
        
        showNotification('Пользователь успешно разблокирован', 'success');
        
        // Перезагружаем список пользователей
        const currentPage = parseInt(document.getElementById('current-users-page').textContent);
        const searchQuery = document.getElementById('user-search')?.value.trim() || '';
        loadUsers(currentPage, searchQuery);
    } catch (error) {
        console.error('Ошибка при разблокировке пользователя:', error);
        showNotification('Ошибка при разблокировке пользователя', 'error');
    }
}

// Скрытие админ-панели
function hideAdminPanel() {
    // Анимация скрытия
    const adminContent = document.querySelector('.admin-content');
    adminContent.style.opacity = '0';
    adminContent.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
        adminPanel.classList.add('hidden');
        document.body.style.overflow = ''; // Восстановление прокрутки
        
        // Скрываем редактор
        editorContainer.classList.add('hidden');
        
        // Сбрасываем значения полей
        postTitleInput.value = '';
        if (editor) {
            editor.root.innerHTML = '';
        }
        currentPostId = null;
    }, 300);
}

// Функция для открытия модального окна ввода имени
function openNameModal() {
    const nameModal = document.getElementById('name-modal');
    nameModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Добавляем анимацию для кнопки закрытия
    const closeButton = nameModal.querySelector('.close-name-modal');
    closeButton.style.transform = 'rotate(0deg)';
    closeButton.style.opacity = '0';
    setTimeout(() => {
        closeButton.style.opacity = '1';
        closeButton.style.transition = 'opacity 0.3s, transform 0.5s, background 0.3s, color 0.3s, box-shadow 0.3s';
    }, 300);
}

// Функция для закрытия модального окна ввода имени
function closeNameModal() {
    const nameModal = document.getElementById('name-modal');
    nameModal.classList.add('hidden');
    document.body.style.overflow = '';
}

// Функция для отображения модального окна изменения имени пользователя
async function showEditUsernameModal(userId) {
    try {
        // Получаем информацию о пользователе
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();
            
        if (error) {
            console.error('Ошибка при получении данных пользователя:', error);
            showNotification('Ошибка при получении данных пользователя', 'error');
            return;
        }
        
        if (!user) {
            showNotification('Пользователь не найден', 'error');
            return;
        }
        
        // Создаем модальное окно для изменения имени пользователя
        const editUsernameModal = document.createElement('div');
        editUsernameModal.classList.add('modal');
        editUsernameModal.id = 'edit-username-modal';
        editUsernameModal.style.position = 'fixed';
        editUsernameModal.style.top = '0';
        editUsernameModal.style.left = '0';
        editUsernameModal.style.width = '100%';
        editUsernameModal.style.height = '100%';
        editUsernameModal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        editUsernameModal.style.display = 'flex';
        editUsernameModal.style.justifyContent = 'center';
        editUsernameModal.style.alignItems = 'center';
        editUsernameModal.style.zIndex = '1001';
        
        // Создаем содержимое модального окна
        editUsernameModal.innerHTML = `
            <div class="modal-content" style="background-color: #1e1e2d; border-radius: 10px; padding: 20px; width: 90%; max-width: 500px; box-shadow: 0 0 20px rgba(0, 0, 0, 0.5); position: relative;">
                <button class="close-btn" style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: white; font-size: 24px; cursor: pointer;"><i class="fas fa-times"></i></button>
                <h2 style="margin-top: 0; color: white; font-size: 20px; margin-bottom: 20px;">Изменение имени пользователя</h2>
                <div style="margin-bottom: 15px;">
                    <p style="margin: 0; color: #bdc3c7; margin-bottom: 5px;">IP адрес: <span style="color: white;">${user.ip_address}</span></p>
                    <p style="margin: 0; color: #bdc3c7; margin-bottom: 15px;">Текущее имя: <span style="color: white;">${user.username}</span></p>
                </div>
                <div style="margin-bottom: 20px;">
                    <label for="new-username" style="display: block; margin-bottom: 5px; color: white;">Новое имя:</label>
                    <input type="text" id="new-username" value="${user.username}" style="width: 100%; padding: 10px; border-radius: 5px; border: 1px solid #3a3a4c; background-color: #2d2d3f; color: white; box-sizing: border-box;">
                    <p id="username-error" style="color: #f44336; margin-top: 5px; display: none;"></p>
                </div>
                <div style="display: flex; justify-content: flex-end;">
                    <button id="cancel-edit-username" style="background-color: #95a5a6; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; margin-right: 10px;">Отмена</button>
                    <button id="save-username" style="background-color: #3498db; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer;">Сохранить</button>
                </div>
            </div>
        `;
        
        // Добавляем модальное окно на страницу
        document.body.appendChild(editUsernameModal);
        
        // Анимация появления
        setTimeout(() => {
            const modalContent = editUsernameModal.querySelector('.modal-content');
            modalContent.style.transition = 'transform 0.3s, opacity 0.3s';
            modalContent.style.transform = 'translateY(0)';
            modalContent.style.opacity = '1';
        }, 10);
        
        // Функция для закрытия модального окна
        const closeModal = () => {
            const modalContent = editUsernameModal.querySelector('.modal-content');
            modalContent.style.transform = 'translateY(-20px)';
            modalContent.style.opacity = '0';
            
            setTimeout(() => {
                document.body.removeChild(editUsernameModal);
            }, 300);
        };
        
        // Добавляем обработчики событий
        editUsernameModal.querySelector('.close-btn').addEventListener('click', closeModal);
        document.getElementById('cancel-edit-username').addEventListener('click', closeModal);
        
        // Обработчик для кнопки сохранения
        document.getElementById('save-username').addEventListener('click', async () => {
            const newUsername = document.getElementById('new-username').value.trim();
            const usernameError = document.getElementById('username-error');
            
            // Валидация имени
            if (!newUsername) {
                usernameError.textContent = 'Пожалуйста, введите имя пользователя';
                usernameError.style.display = 'block';
                return;
            }
            
            if (newUsername.length < 2) {
                usernameError.textContent = 'Имя должно содержать не менее 2 символов';
                usernameError.style.display = 'block';
                return;
            }
            
            if (newUsername.length > 30) {
                usernameError.textContent = 'Имя должно содержать не более 30 символов';
                usernameError.style.display = 'block';
                return;
            }
            
            // Если имя не изменилось, просто закрываем модальное окно
            if (newUsername === user.username) {
                closeModal();
                return;
            }
            
            try {
                // Блокируем кнопку сохранения
                const saveButton = document.getElementById('save-username');
                saveButton.disabled = true;
                saveButton.textContent = 'Сохранение...';
                
                // Обновляем имя пользователя в базе данных
                const { error: updateError } = await supabase
                    .from('users')
                    .update({ username: newUsername, updated_at: new Date() })
                    .eq('id', userId);
                    
                if (updateError) {
                    console.error('Ошибка при обновлении имени пользователя:', updateError);
                    usernameError.textContent = 'Ошибка при обновлении имени пользователя';
                    usernameError.style.display = 'block';
                    
                    // Разблокируем кнопку
                    saveButton.disabled = false;
                    saveButton.textContent = 'Сохранить';
                    return;
                }
                
                // Обновляем имя пользователя во всех его комментариях
                try {
                    saveButton.textContent = 'Обновление комментариев...';
                    
                    // Получаем все комментарии пользователя по его IP
                    const { data: comments, error: commentsError } = await supabase
                        .from('comments')
                        .select('id')
                        .eq('author_ip', user.ip_address);
                        
                    if (commentsError) {
                        console.error('Ошибка при получении комментариев пользователя:', commentsError);
                        // Продолжаем выполнение, так как основная задача (обновление имени) уже выполнена
                    } else if (comments && comments.length > 0) {
                        console.log(`Найдено ${comments.length} комментариев для обновления имени пользователя`);
                        
                        // Обновляем имя автора во всех комментариях
                        const { error: updateCommentsError } = await supabase
                            .from('comments')
                            .update({ author_name: newUsername })
                            .eq('author_ip', user.ip_address);
                            
                        if (updateCommentsError) {
                            console.error('Ошибка при обновлении имени в комментариях:', updateCommentsError);
                            // Продолжаем выполнение, так как основная задача (обновление имени) уже выполнена
                        } else {
                            console.log(`Успешно обновлено имя в ${comments.length} комментариях`);
                        }
                    }
                } catch (commentError) {
                    console.error('Ошибка при обновлении комментариев:', commentError);
                    // Продолжаем выполнение, так как основная задача (обновление имени) уже выполнена
                }
                
                // Закрываем модальное окно
                closeModal();
                
                // Показываем уведомление
                showNotification(`Имя пользователя успешно изменено на "${newUsername}"`, 'success');
                
                // Обновляем список пользователей
                const currentPage = parseInt(document.getElementById('current-users-page').textContent);
                const searchQuery = document.getElementById('user-search').value.trim();
                loadUsers(currentPage, searchQuery);
                
                // Если это текущий пользователь, обновляем его имя в интерфейсе
                if (user.ip_address === userIP) {
                    authorName = newUsername;
                    updateAuthorNameDisplay();
                }
                
                // Если мы находимся на странице статьи, перезагружаем комментарии
                const urlParams = new URLSearchParams(window.location.search);
                const articleId = urlParams.get('id');
                if (articleId && currentArticle) {
                    // Перезагружаем комментарии для текущей статьи
                    loadComments(articleId);
                }
            } catch (error) {
                console.error('Ошибка при обновлении имени пользователя:', error);
                usernameError.textContent = 'Произошла ошибка. Пожалуйста, попробуйте еще раз.';
                usernameError.style.display = 'block';
                
                // Разблокируем кнопку
                const saveButton = document.getElementById('save-username');
                if (saveButton) {
                    saveButton.disabled = false;
                    saveButton.textContent = 'Сохранить';
                }
            }
        });
        
        // Обработчик для клавиши Enter
        document.getElementById('new-username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('save-username').click();
            }
        });
        
        // Обработчик для скрытия ошибки при вводе
        document.getElementById('new-username').addEventListener('input', () => {
            document.getElementById('username-error').style.display = 'none';
        });
        
        // Фокус на поле ввода
        setTimeout(() => {
            const input = document.getElementById('new-username');
            input.focus();
            input.select();
        }, 100);
    } catch (error) {
        console.error('Ошибка при отображении модального окна изменения имени:', error);
        showNotification('Ошибка при отображении модального окна изменения имени', 'error');
    }
}

// Функция для удаления пользователя и всех его данных
async function deleteUser(userId) {
    try {
        // Получаем информацию о пользователе
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();
            
        if (userError) {
            console.error('Ошибка при получении данных пользователя:', userError);
            showNotification('Ошибка при получении данных пользователя', 'error');
            return;
        }
        
        if (!user) {
            showNotification('Пользователь не найден', 'error');
            return;
        }
        
        // Показываем уведомление о процессе
        showNotification('Удаление пользователя и его данных...', 'info');
        
        // Получаем все комментарии пользователя
        const { data: comments, error: commentsError } = await supabase
            .from('comments')
            .select('*')
            .eq('author_id', userId);
            
        if (commentsError) {
            console.error('Ошибка при получении комментариев пользователя:', commentsError);
            showNotification('Ошибка при получении комментариев пользователя', 'error');
            return;
        }
        
        // Удаляем все фотографии из комментариев пользователя
        if (comments && comments.length > 0) {
            console.log(`Найдено ${comments.length} комментариев для удаления`);
            
            // Собираем все пути к фотографиям
            const photoPaths = [];
            comments.forEach(comment => {
                if (comment.photos && comment.photos.length > 0) {
                    comment.photos.forEach(photo => {
                        if (photo.url) {
                            // Извлекаем путь к файлу из URL
                            const url = new URL(photo.url);
                            const pathMatch = url.pathname.match(/\/comments-photos\/storage\/v1\/object\/public\/comments-photos\/(.+)$/);
                            if (pathMatch && pathMatch[1]) {
                                photoPaths.push(pathMatch[1]);
                            }
                        }
                    });
                }
            });
            
            // Удаляем фотографии из хранилища
            if (photoPaths.length > 0) {
                console.log(`Удаление ${photoPaths.length} фотографий из хранилища`);
                const { error: deletePhotosError } = await supabase.storage
                    .from('comments-photos')
                    .remove(photoPaths);
                    
                if (deletePhotosError) {
                    console.error('Ошибка при удалении фотографий:', deletePhotosError);
                    // Продолжаем выполнение, так как основная задача - удаление пользователя
                } else {
                    console.log('Фотографии успешно удалены');
                }
            }
            
            // Удаляем все комментарии пользователя
            const { error: deleteCommentsError } = await supabase
                .from('comments')
                .delete()
            .eq('author_id', userId);
                
            if (deleteCommentsError) {
                console.error('Ошибка при удалении комментариев пользователя:', deleteCommentsError);
                showNotification('Ошибка при удалении комментариев пользователя', 'error');
                return;
            }
            
            console.log('Комментарии пользователя успешно удалены');
        }
        
        // Удаляем пользователя из базы данных
        const { error: deleteUserError } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);
            
        if (deleteUserError) {
            console.error('Ошибка при удалении пользователя:', deleteUserError);
            showNotification('Ошибка при удалении пользователя', 'error');
            return;
        }
        
        // Показываем уведомление об успешном удалении
        showNotification('Пользователь и все его данные успешно удалены', 'success');
        
        // Обновляем список пользователей
        const currentPage = parseInt(document.getElementById('current-users-page').textContent);
        const searchQuery = document.getElementById('user-search').value.trim();
        loadUsers(currentPage, searchQuery);
        
        // Если мы находимся на странице статьи, перезагружаем комментарии
        const urlParams = new URLSearchParams(window.location.search);
        const articleId = urlParams.get('id');
        if (articleId && currentArticle) {
            // Перезагружаем комментарии для текущей статьи
            loadComments(articleId);
        }
        
        // Если удаленный пользователь - текущий пользователь, сбрасываем его данные
        if (user.ip_address === userIP) {
            authorName = '';
            localStorage.removeItem(IP_STORAGE_KEY);
            
            // Показываем модальное окно для ввода нового имени
            setTimeout(() => {
                showNameModal();
            }, 1000);
            
            // Обновляем отображение имени в интерфейсе
            updateAuthorNameDisplay();
        }
    } catch (error) {
        console.error('Ошибка при удалении пользователя:', error);
        showNotification('Ошибка при удалении пользователя', 'error');
    }
}

// Функция для отображения модального окна подтверждения удаления пользователя
function showDeleteUserModal(userId) {
    try {
        // Получаем информацию о пользователе
        supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single()
            .then(({ data: user, error }) => {
                if (error) {
                    console.error('Ошибка при получении данных пользователя:', error);
                    showNotification('Ошибка при получении данных пользователя', 'error');
                    return;
                }
                
                if (!user) {
                    showNotification('Пользователь не найден', 'error');
                    return;
                }
                
                // Создаем модальное окно для подтверждения удаления
                const deleteUserModal = document.createElement('div');
                deleteUserModal.classList.add('modal');
                deleteUserModal.id = 'delete-user-modal';
                deleteUserModal.style.position = 'fixed';
                deleteUserModal.style.top = '0';
                deleteUserModal.style.left = '0';
                deleteUserModal.style.width = '100%';
                deleteUserModal.style.height = '100%';
                deleteUserModal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                deleteUserModal.style.display = 'flex';
                deleteUserModal.style.justifyContent = 'center';
                deleteUserModal.style.alignItems = 'center';
                deleteUserModal.style.zIndex = '1001';
                
                // Создаем содержимое модального окна
                deleteUserModal.innerHTML = `
                    <div class="modal-content" style="background-color: #1e1e2d; border-radius: 10px; padding: 20px; width: 90%; max-width: 500px; box-shadow: 0 0 20px rgba(0, 0, 0, 0.5); position: relative; border-left: 4px solid #f44336;">
                        <button class="close-btn" style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: white; font-size: 24px; cursor: pointer;"><i class="fas fa-times"></i></button>
                        <h2 style="margin-top: 0; color: white; font-size: 20px; margin-bottom: 20px;">Удаление пользователя</h2>
                        <div style="margin-bottom: 15px;">
                            <p style="margin: 0; color: #bdc3c7; margin-bottom: 5px;">IP адрес: <span style="color: white;">${user.ip_address}</span></p>
                            <p style="margin: 0; color: #bdc3c7; margin-bottom: 15px;">Имя пользователя: <span style="color: white;">${user.username}</span></p>
                        </div>
                        <div style="background-color: rgba(244, 67, 54, 0.1); border-radius: 5px; padding: 15px; margin-bottom: 20px; border: 1px solid rgba(244, 67, 54, 0.3);">
                            <p style="margin: 0; color: #f44336; font-weight: bold; margin-bottom: 10px;"><i class="fas fa-exclamation-triangle" style="margin-right: 10px;"></i>Внимание!</p>
                            <p style="margin: 0; color: #bdc3c7;">Это действие приведет к полному удалению пользователя и всех его данных:</p>
                            <ul style="color: #bdc3c7; margin-top: 10px; margin-bottom: 0; padding-left: 25px;">
                                <li>Профиль пользователя</li>
                                <li>Все комментарии</li>
                                <li>Все загруженные фотографии</li>
                            </ul>
                            <p style="margin: 10px 0 0 0; color: #bdc3c7;">Это действие <strong>необратимо</strong>.</p>
                        </div>
                        <div style="display: flex; justify-content: flex-end;">
                            <button id="cancel-delete-user" style="background-color: #95a5a6; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; margin-right: 10px;">Отмена</button>
                            <button id="confirm-delete-user" style="background-color: #f44336; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer;">Удалить</button>
                        </div>
                    </div>
                `;
                
                // Добавляем модальное окно на страницу
                document.body.appendChild(deleteUserModal);
                
                // Анимация появления
                setTimeout(() => {
                    const modalContent = deleteUserModal.querySelector('.modal-content');
                    modalContent.style.transition = 'transform 0.3s, opacity 0.3s';
                    modalContent.style.transform = 'translateY(0)';
                    modalContent.style.opacity = '1';
                }, 10);
                
                // Функция для закрытия модального окна
                const closeModal = () => {
                    const modalContent = deleteUserModal.querySelector('.modal-content');
                    modalContent.style.transform = 'translateY(-20px)';
                    modalContent.style.opacity = '0';
                    
                    setTimeout(() => {
                        document.body.removeChild(deleteUserModal);
                    }, 300);
                };
                
                // Добавляем обработчики событий
                deleteUserModal.querySelector('.close-btn').addEventListener('click', closeModal);
                document.getElementById('cancel-delete-user').addEventListener('click', closeModal);
                
                // Обработчик для кнопки подтверждения удаления
                document.getElementById('confirm-delete-user').addEventListener('click', async () => {
                    // Блокируем кнопку подтверждения
                    const confirmButton = document.getElementById('confirm-delete-user');
                    confirmButton.disabled = true;
                    confirmButton.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right: 10px;"></i>Удаление...';
                    
                    // Закрываем модальное окно
                    closeModal();
                    
                    // Удаляем пользователя
                    await deleteUser(userId);
                });
            })
            .catch(error => {
                console.error('Ошибка при получении данных пользователя:', error);
                showNotification('Ошибка при получении данных пользователя', 'error');
            });
    } catch (error) {
        console.error('Ошибка при отображении модального окна удаления пользователя:', error);
        showNotification('Ошибка при отображении модального окна удаления пользователя', 'error');
    }
}

// Функция для отображения модального окна загрузки изображения для редактора
function showImageUploadModal() {
    // Создаем модальное окно, если оно еще не существует
    let imageUploadModal = document.getElementById('image-upload-modal');
    
    if (!imageUploadModal) {
        imageUploadModal = document.createElement('div');
        imageUploadModal.id = 'image-upload-modal';
        imageUploadModal.className = 'modal hidden';
        imageUploadModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Загрузка изображения</h3>
                    <button class="close-modal close-image-upload-modal"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="upload-form">
                        <div class="file-input-wrapper">
                            <label for="editor-image-file-input" class="file-input-label">
                                <i class="fas fa-cloud-upload-alt"></i>
                                <span>Выберите изображение</span>
                            </label>
                            <input type="file" id="editor-image-file-input" accept="image/*" class="file-input">
                        </div>
                        <div class="editor-upload-preview empty"></div>
                        <div id="editor-upload-error" class="upload-error hidden"></div>
                        <div class="editor-upload-progress hidden">
                            <div class="progress-bar">
                                <div class="progress-bar-fill"></div>
                            </div>
                            <div class="progress-text">0%</div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="editor-upload-image-btn" class="btn primary-btn" disabled>Загрузить</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(imageUploadModal);
        
        // Добавляем стили для модального окна
        const style = document.createElement('style');
        style.textContent = `
            .editor-upload-preview {
                width: 100%;
                height: 200px;
                border: 2px dashed #4a4a5a;
                border-radius: 5px;
                margin: 15px 0;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
            }
            
            .editor-upload-preview.empty::before {
                content: 'Предпросмотр изображения';
                color: #6c757d;
            }
            
            .editor-upload-preview img {
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
            }
            
            .editor-upload-progress {
                margin-top: 15px;
            }
            
            .custom-toolbar-button {
                display: flex !important;
                align-items: center;
                justify-content: center;
            }
        `;
        document.head.appendChild(style);
        
        // Добавляем обработчики событий
        const closeBtn = imageUploadModal.querySelector('.close-image-upload-modal');
        const fileInput = document.getElementById('editor-image-file-input');
        const uploadBtn = document.getElementById('editor-upload-image-btn');
        const uploadPreview = imageUploadModal.querySelector('.editor-upload-preview');
        const uploadError = document.getElementById('editor-upload-error');
        
        closeBtn.addEventListener('click', () => {
            imageUploadModal.classList.add('hidden');
        });
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                // Проверяем тип файла
                if (!file.type.startsWith('image/')) {
                    uploadError.textContent = 'Пожалуйста, выберите изображение';
                    uploadError.classList.remove('hidden');
                    uploadPreview.innerHTML = '';
                    uploadPreview.classList.add('empty');
                    uploadBtn.disabled = true;
                    return;
                }
                
                // Проверяем размер файла (не более 5 МБ)
                if (file.size > 5 * 1024 * 1024) {
                    uploadError.textContent = 'Размер файла не должен превышать 5 МБ';
                    uploadError.classList.remove('hidden');
                    uploadPreview.innerHTML = '';
                    uploadPreview.classList.add('empty');
                    uploadBtn.disabled = true;
                    return;
                }
                
                // Показываем предпросмотр
                const reader = new FileReader();
                reader.onload = (e) => {
                    uploadPreview.innerHTML = `<img src="${e.target.result}" alt="Предпросмотр">`;
                    uploadPreview.classList.remove('empty');
                    uploadBtn.disabled = false;
                    uploadError.classList.add('hidden');
                };
                reader.readAsDataURL(file);
            }
        });
        
        uploadBtn.addEventListener('click', () => {
            uploadEditorImage();
        });
    }
    
    // Очищаем предыдущие данные
    const uploadPreview = imageUploadModal.querySelector('.editor-upload-preview');
    const fileInput = document.getElementById('editor-image-file-input');
    const uploadBtn = document.getElementById('editor-upload-image-btn');
    const uploadError = document.getElementById('editor-upload-error');
    
    uploadPreview.innerHTML = '';
    uploadPreview.classList.add('empty');
    fileInput.value = '';
    uploadBtn.disabled = true;
    uploadError.classList.add('hidden');
    
    // Показываем модальное окно
    imageUploadModal.classList.remove('hidden');
}

// Функция для загрузки изображения в редактор
async function uploadEditorImage() {
    const imageUploadModal = document.getElementById('image-upload-modal');
    const fileInput = document.getElementById('editor-image-file-input');
    const uploadBtn = document.getElementById('editor-upload-image-btn');
    const uploadProgress = imageUploadModal.querySelector('.editor-upload-progress');
    const progressBarFill = uploadProgress.querySelector('.progress-bar-fill');
    const progressText = uploadProgress.querySelector('.progress-text');
    const uploadError = document.getElementById('editor-upload-error');
    
    // Проверяем, выбран ли файл
    const file = fileInput.files[0];
    if (!file) {
        uploadError.textContent = 'Пожалуйста, выберите файл';
        uploadError.classList.remove('hidden');
        return;
    }
    
    try {
        // Показываем индикатор прогресса
        uploadProgress.classList.remove('hidden');
        uploadBtn.disabled = true;
        
        // Генерируем уникальное имя файла
        const fileExt = file.name.split('.').pop();
        const fileName = `editor_${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
        const filePath = `editor-images/${fileName}`;
        
        // Загружаем файл в Supabase Storage
        const { data, error } = await supabase.storage
            .from('comments-photos')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                onUploadProgress: (progress) => {
                    const percent = Math.round((progress.loaded / progress.total) * 100);
                    progressBarFill.style.width = `${percent}%`;
                    progressText.textContent = `${percent}%`;
                }
            });
            
        if (error) {
            throw error;
        }
        
        // Получаем публичный URL файла
        const { data: publicURL } = supabase.storage
            .from('comments-photos')
            .getPublicUrl(filePath);
            
        // Вставляем изображение в редактор
        if (editor && imageUploadRange) {
            editor.insertEmbed(imageUploadRange.index, 'image', publicURL.publicUrl);
            editor.setSelection(imageUploadRange.index + 1);
        }
        
        // Показываем уведомление об успешной загрузке
        showNotification('Изображение успешно загружено', 'success');
        
        // Закрываем модальное окно
        imageUploadModal.classList.add('hidden');
        
    } catch (error) {
        console.error('Ошибка при загрузке изображения:', error);
        uploadError.textContent = `Ошибка при загрузке изображения: ${error.message || 'Пожалуйста, попробуйте еще раз'}`;
        uploadError.classList.remove('hidden');
        
        // Показываем уведомление об ошибке
        showNotification('Не удалось загрузить изображение', 'error');
    } finally {
        // Скрываем индикатор прогресса
        uploadProgress.classList.add('hidden');
        uploadBtn.disabled = false;
    }
}
  