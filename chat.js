// Функциональность чата
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM загружен, инициализируем чат');
    
    // Элементы интерфейса чата
    const chatButton = document.getElementById('chat-button');
    const mobileChatButton = document.getElementById('mobile-chat-button');
    const chatModal = document.getElementById('chat-modal');
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    const chatMessages = document.getElementById('chat-messages');
    const messagesList = document.getElementById('messages-list');
    const emptyChat = document.getElementById('empty-chat');
    const chatInput = document.getElementById('chat-input');
    const sendMessageBtn = document.getElementById('send-message-btn');
    const chatNotification = document.getElementById('chat-notification');
    const mobileChatNotification = document.getElementById('mobile-chat-notification');
    const loadMoreContainer = document.getElementById('load-more-container');
    const loadMoreBtn = document.getElementById('load-more-btn');
    
    // Переменные для работы с ответами на сообщения
    let replyToMessage = null;
    let replyContainer = null;
    let contextMenu = null;
    
    // Убираем синее выделение при нажатии на элементы чата
    const chatElements = document.querySelectorAll('.chat-button, .send-message-btn, .close-chat, button, input');
    chatElements.forEach(element => {
        element.style.outline = 'none';
        element.style.webkitTapHighlightColor = 'transparent';
        element.style.webkitTouchCallout = 'none';
        element.style.webkitUserSelect = 'none';
        element.style.mozUserSelect = 'none';
        element.style.msUserSelect = 'none';
        element.style.userSelect = 'none';
    });
    
    // Проверяем, что все элементы найдены
    console.log('Проверка элементов чата:');
    console.log('chatButton:', chatButton);
    console.log('mobileChatButton:', mobileChatButton);
    console.log('chatModal:', chatModal);
    console.log('chatContainer:', chatContainer);
    console.log('closeChat:', closeChat);
    console.log('chatMessages:', chatMessages);
    console.log('messagesList:', messagesList);
    
    // Проверяем видимость кнопки чата
    if (chatButton) {
        const style = window.getComputedStyle(chatButton);
        console.log('Видимость кнопки чата:', style.display);
        console.log('Позиция кнопки чата:', style.position);
        console.log('Z-index кнопки чата:', style.zIndex);
        console.log('Классы кнопки чата:', chatButton.className);
        
        // Убеждаемся, что кнопка видима
        chatButton.style.display = 'flex';
        chatButton.style.zIndex = '9999';
        
        // Удаляем класс hidden, если он есть
        chatButton.classList.remove('hidden');
        
        // Добавляем обработчик клика на кнопку чата
        chatButton.addEventListener('click', function(e) {
            console.log('Кнопка чата нажата (обработчик из chat.js)');
            e.preventDefault();
            window.openChat();
            return false;
        });
    }
    
    // Обработчик для мобильной кнопки чата
    if (mobileChatButton) {
        console.log('Мобильная кнопка чата найдена');
        
        // Добавляем обработчик клика на мобильную кнопку чата
        mobileChatButton.addEventListener('click', function(e) {
            console.log('Мобильная кнопка чата нажата');
            e.preventDefault();
            window.openChat();
            return false;
        });
    }
    
    // Добавляем обработчик для кнопки закрытия чата
    if (closeChat) {
        closeChat.addEventListener('click', function(e) {
            console.log('Кнопка закрытия чата нажата (обработчик из chat.js)');
            e.preventDefault();
            window.closeChat();
            return false;
        });
    }
    
    // Переменные для работы с чатом
    let authorName = localStorage.getItem('author_name') || '';
    let lastMessageTime = null;
    let isFirstLoad = true;
    let messagesCount = 0;
    let oldestMessageTimestamp = null;
    let newestMessageTimestamp = null;
    let isLoadingMore = false;
    let chatSubscription = null;
    let unreadMessages = 0;
    
    // Инициализация Supabase (используем существующий клиент)
    const supabase = window.supabaseClient;
    console.log('Supabase клиент доступен:', supabase ? 'Да' : 'Нет');
    
    // Функция для открытия чата (делаем глобальной)
    window.openChat = function() {
        console.log('Функция openChat вызвана');
        
        // Скрываем кнопки чата
        hideAllChatButtons();
        
        // Инициализируем имя пользователя
        initAuthorName();
        
        // Если имя пользователя не задано, пробуем получить его из script.js
        if (!authorName && window.authorName) {
            authorName = window.authorName;
            localStorage.setItem('author_name', authorName);
            console.log('Имя пользователя получено из script.js:', authorName);
        }
        
        // Если имя пользователя все еще не задано, открываем модальное окно для ввода имени
        if (!authorName) {
            console.log('Имя пользователя не задано, открываем модальное окно');
            showNameModal();
            return;
        }
        
        console.log('Имя пользователя найдено:', authorName);
        
        // Устанавливаем максимальный z-index для модального окна и контейнера чата
        if (chatModal) {
            chatModal.style.zIndex = '99999';
        }
        if (chatContainer) {
            chatContainer.style.zIndex = '100000';
        }
        
        // Добавляем класс для анимации открытия
        document.body.classList.add('chat-open');
        chatModal.classList.add('active');
        chatContainer.classList.add('slide-in');
        chatContainer.classList.remove('slide-out');
        
        // Добавляем красивый эффект появления
        setTimeout(() => {
            const messages = document.querySelectorAll('.chat-message');
            messages.forEach((msg, index) => {
                setTimeout(() => {
                    msg.style.opacity = '0';
                    msg.style.transform = 'translateY(20px)';
                    msg.style.transition = 'all 0.3s ease';
                    
                    setTimeout(() => {
                        msg.style.opacity = '1';
                        msg.style.transform = 'translateY(0)';
                    }, 50);
                }, index * 100);
            });
        }, 300);
        
        // Убедимся, что кнопка отправки сообщений видна
        const sendBtn = document.getElementById('send-message-btn');
        if (sendBtn) {
            sendBtn.style.position = 'relative';
            sendBtn.style.zIndex = '999999';
            sendBtn.style.display = 'flex';
            sendBtn.style.visibility = 'visible';
            sendBtn.style.opacity = '1';
        }
        
        // Сбрасываем счетчик непрочитанных сообщений
        unreadMessages = 0;
        updateNotificationBadge();
        
        // Загружаем последние сообщения
        loadLatestMessages();
        
        // Фокус на поле ввода
        setTimeout(() => {
            chatInput.focus();
        }, 300);
    }
    
    // Функция для закрытия чата (делаем глобальной)
    window.closeChat = function() {
        console.log('Функция closeChat вызвана');
        
        // Добавляем анимацию закрытия
        chatContainer.classList.remove('slide-in');
        chatContainer.classList.add('slide-out');
        
        // Плавно скрываем модальное окно
        chatModal.style.transition = 'opacity 0.3s ease';
        chatModal.style.opacity = '0';
        
        setTimeout(() => {
            chatModal.classList.remove('active');
            document.body.classList.remove('chat-open');
            
            // Показываем кнопки чата
            showAllChatButtons();
            
            // Сбрасываем стили
            chatModal.style.transition = '';
            chatModal.style.opacity = '';
        }, 300);
    }
    
    // Функция для скрытия всех кнопок чата
    function hideAllChatButtons() {
        // Скрываем основную кнопку чата
        if (chatButton) {
            console.log('Скрываем основную кнопку чата');
            chatButton.style.display = 'none';
            chatButton.style.opacity = '0';
            chatButton.style.visibility = 'hidden';
            chatButton.style.pointerEvents = 'none';
        }
        
        // Скрываем мобильную кнопку чата
        if (mobileChatButton) {
            console.log('Скрываем мобильную кнопку чата');
            mobileChatButton.style.display = 'none';
            mobileChatButton.style.opacity = '0';
            mobileChatButton.style.visibility = 'hidden';
            mobileChatButton.style.pointerEvents = 'none';
        }
    }
    
    // Функция для показа всех кнопок чата
    function showAllChatButtons() {
        // Определяем, на каком устройстве мы находимся
        const isMobile = window.innerWidth <= 767;
        
        // Показываем соответствующую кнопку чата
        if (isMobile) {
            // На мобильном показываем верхнюю кнопку
            if (mobileChatButton) {
                console.log('Показываем мобильную кнопку чата');
                mobileChatButton.style.display = 'flex';
                mobileChatButton.style.opacity = '1';
                mobileChatButton.style.visibility = 'visible';
                mobileChatButton.style.pointerEvents = 'auto';
            }
        } else {
            // На ПК показываем нижнюю кнопку
            if (chatButton) {
                console.log('Показываем основную кнопку чата');
                chatButton.style.display = 'flex';
                chatButton.style.opacity = '1';
                chatButton.style.visibility = 'visible';
                chatButton.style.pointerEvents = 'auto';
            }
        }
    }
    
    // Функция для обновления счетчика непрочитанных сообщений
    function updateNotificationBadge() {
        if (chatNotification) {
            if (unreadMessages > 0) {
                chatNotification.textContent = unreadMessages > 99 ? '99+' : unreadMessages;
                chatNotification.style.display = 'flex';
            } else {
                chatNotification.style.display = 'none';
            }
        }
        
        if (mobileChatNotification) {
            if (unreadMessages > 0) {
                mobileChatNotification.textContent = unreadMessages > 99 ? '99+' : unreadMessages;
                mobileChatNotification.style.display = 'flex';
            } else {
                mobileChatNotification.style.display = 'none';
            }
        }
    }
    
    // Функция для загрузки последних сообщений
    async function loadLatestMessages() {
        try {
            // Показываем индикатор загрузки
            messagesList.innerHTML = '<div class="loading-messages"><i class="fas fa-spinner fa-spin"></i> Загрузка сообщений...</div>';
            
            // Запрашиваем последние 99 сообщений
            const { data, error } = await supabase
                .from('chat_messages')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(99);
                
            if (error) throw error;
            
            // Очищаем список сообщений
            messagesList.innerHTML = '';
            
            if (data && data.length > 0) {
                // Скрываем заглушку пустого чата
                emptyChat.classList.add('hidden');
                
                // Сортируем сообщения по времени (от старых к новым)
                data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                
                // Запоминаем временную метку самого старого сообщения
                oldestMessageTimestamp = data[0].created_at;
                
                // Запоминаем временную метку самого нового сообщения
                newestMessageTimestamp = data[data.length - 1].created_at;
                
                // Отображаем сообщения
                data.forEach(message => {
                    displayMessage(message);
                });
                
                messagesCount = data.length;
                
                // Показываем кнопку "Загрузить еще", если есть еще сообщения
                if (messagesCount >= 99) {
                    loadMoreContainer.classList.remove('hidden');
                } else {
                    loadMoreContainer.classList.add('hidden');
                }
                
                // Прокручиваем чат вниз
                chatMessages.scrollTop = chatMessages.scrollHeight;
            } else {
                // Показываем заглушку пустого чата
                emptyChat.classList.remove('hidden');
                messagesCount = 0;
                loadMoreContainer.classList.add('hidden');
            }
            
            // Подписываемся на новые сообщения, если это первая загрузка
            if (isFirstLoad) {
                subscribeToNewMessages();
                isFirstLoad = false;
            }
        } catch (error) {
            console.error('Ошибка при загрузке сообщений:', error);
            messagesList.innerHTML = '<div class="error-message">Не удалось загрузить сообщения. Пожалуйста, попробуйте позже.</div>';
        }
    }
    
    // Функция для загрузки предыдущих сообщений
    async function loadMoreMessages() {
        if (isLoadingMore) return;
        
        try {
            isLoadingMore = true;
            loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
            
            // Запрашиваем сообщения, которые старше самого старого загруженного сообщения
            const { data, error } = await supabase
                .from('chat_messages')
                .select('*')
                .lt('created_at', oldestMessageTimestamp)
                .order('created_at', { ascending: false })
                .limit(99);
                
            if (error) throw error;
            
            if (data && data.length > 0) {
                // Сортируем сообщения по времени (от новых к старым)
                data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                
                // Запоминаем временную метку самого старого сообщения
                oldestMessageTimestamp = data[data.length - 1].created_at;
                
                // Создаем фрагмент для новых сообщений
                const fragment = document.createDocumentFragment();
                
                // Создаем элементы сообщений и добавляем их во фрагмент
                data.forEach(message => {
                    const messageElement = createMessageElement(message);
                    fragment.appendChild(messageElement);
                });
                
                // Запоминаем текущую высоту прокрутки
                const scrollHeight = chatMessages.scrollHeight;
                
                // Добавляем фрагмент в конец списка сообщений
                messagesList.appendChild(fragment);
                
                // Обновляем счетчик сообщений
                messagesCount += data.length;
                
                // Скрываем кнопку "Загрузить еще", если больше нет сообщений
                if (data.length < 99) {
                    loadMoreContainer.classList.add('hidden');
                }
                
                // Восстанавливаем позицию прокрутки
                chatMessages.scrollTop = chatMessages.scrollHeight - scrollHeight;
            } else {
                // Больше нет сообщений для загрузки
                loadMoreContainer.classList.add('hidden');
            }
        } catch (error) {
            console.error('Ошибка при загрузке предыдущих сообщений:', error);
            loadMoreBtn.innerHTML = '<i class="fas fa-exclamation-circle"></i> Ошибка загрузки';
            
            setTimeout(() => {
                loadMoreBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Загрузить предыдущие сообщения';
            }, 3000);
        } finally {
            isLoadingMore = false;
            loadMoreBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Загрузить предыдущие сообщения';
        }
    }
    
    // Функция для отображения сообщения
    function displayMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        messageElement.dataset.id = message.id;
        
        // Создаем аватар
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.style.backgroundColor = getRandomColor(message.author_name);
        avatar.textContent = message.author_name.charAt(0).toUpperCase();
        
        // Создаем контейнер для содержимого сообщения
        const content = document.createElement('div');
        content.className = 'message-content';
        
        // Создаем заголовок сообщения (автор и время)
        const header = document.createElement('div');
        header.className = 'message-header';
        
        const author = document.createElement('span');
        author.className = 'message-author';
        author.textContent = message.author_name;
        
        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = formatMessageTime(message.created_at);
        
        header.appendChild(author);
        header.appendChild(time);
        
        // Если это ответ на другое сообщение, добавляем блок с информацией о нем
        if (message.reply_to_id && message.reply_to_author && message.reply_to_text) {
            const replyInfo = document.createElement('div');
            replyInfo.className = 'reply-info';
            replyInfo.innerHTML = `
                <div class="reply-to-author">
                    <i class="fas fa-reply"></i> ${message.reply_to_author}
                </div>
                <div class="reply-to-text">${message.reply_to_text.length > 50 ? message.reply_to_text.substring(0, 50) + '...' : message.reply_to_text}</div>
            `;
            
            // Добавляем возможность перехода к исходному сообщению по клику
            replyInfo.addEventListener('click', function() {
                const originalMessage = document.querySelector(`.chat-message[data-id="${message.reply_to_id}"]`);
                if (originalMessage) {
                    // Прокручиваем к исходному сообщению
                    originalMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    
                    // Подсвечиваем исходное сообщение
                    originalMessage.classList.add('highlighted');
                    setTimeout(() => {
                        originalMessage.classList.remove('highlighted');
                    }, 2000);
                }
            });
            
            content.appendChild(replyInfo);
        }
        
        // Создаем текст сообщения
        const text = document.createElement('div');
        text.className = 'message-text';
        text.textContent = message.message;
        
        // Сохраняем текст сообщения в атрибуте для дальнейшего использования
        messageElement.dataset.text = message.message;
        messageElement.dataset.author = message.author_name;
        
        // Собираем сообщение
        content.appendChild(header);
        content.appendChild(text);
        
        messageElement.appendChild(avatar);
        messageElement.appendChild(content);
        
        // Добавляем мини-кнопку ответа
        const miniReplyBtn = document.createElement('button');
        miniReplyBtn.className = 'mini-reply-btn';
        // Используем иконку из Font Awesome 6, которая уже подключена
        miniReplyBtn.innerHTML = '<i class="fas fa-reply"></i>';
        miniReplyBtn.title = 'Ответить на сообщение';
        
        // Добавляем обработчик события для кнопки
        miniReplyBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Нажата кнопка ответа на сообщение');
            replyToMessageHandler(messageElement);
        });
        
        // Добавляем кнопку в сообщение
        messageElement.appendChild(miniReplyBtn);
        
        // Добавляем обработчики для выделения текста и контекстного меню
        enableTextSelection(messageElement);
        setupMessageContextMenu(messageElement);
        
        // Добавляем сообщение в список с анимацией
        messageElement.style.opacity = '0';
        messageElement.style.transform = 'translateY(20px)';
        messagesList.appendChild(messageElement);
        
        // Запускаем анимацию появления
        setTimeout(() => {
            messageElement.style.transition = 'all 0.3s ease';
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateY(0)';
        }, 10);
        
        // Прокручиваем чат вниз
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
    
    // Функция для включения выделения текста и копирования
    function enableTextSelection(element) {
        // Разрешаем выделение текста во всем сообщении
        element.style.userSelect = 'text';
        element.style.webkitUserSelect = 'text';
        element.style.mozUserSelect = 'text';
        element.style.msUserSelect = 'text';
        
        // Разрешаем выделение текста в содержимом сообщения
        const content = element.querySelector('.message-content');
        if (content) {
            content.style.userSelect = 'text';
            content.style.webkitUserSelect = 'text';
            content.style.mozUserSelect = 'text';
            content.style.msUserSelect = 'text';
        }
        
        // Разрешаем выделение текста в тексте сообщения
        const messageText = element.querySelector('.message-text');
        if (messageText) {
            messageText.style.userSelect = 'text';
            messageText.style.webkitUserSelect = 'text';
            messageText.style.mozUserSelect = 'text';
            messageText.style.msUserSelect = 'text';
            
            // Добавляем обработчик для предотвращения всплытия события mousedown
            messageText.addEventListener('mousedown', function(e) {
                e.stopPropagation();
            });
        }
    }
    
    // Функция для настройки контекстного меню сообщения
    function setupMessageContextMenu(messageElement) {
        // Обработчик правого клика (для ПК)
        messageElement.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            e.stopPropagation(); // Останавливаем всплытие события
            showContextMenu(e, messageElement);
        });
        
        // Обработчик клика для мобильных устройств
        messageElement.addEventListener('click', function(e) {
            // Проверяем, что клик был на сообщении, а не на аватаре или кнопке
            if (e.target.closest('.message-content') && 
                !e.target.closest('.message-reply-btn') && 
                !e.target.closest('.mini-reply-btn') && 
                !e.target.closest('.reply-info')) {
                // Не делаем ничего, позволяем выделять текст
            }
        });
        
        // Обработчик длительного нажатия (для мобильных)
        let pressTimer;
        let startX, startY;
        const longPressThreshold = 500; // 500ms для длительного нажатия
        
        messageElement.addEventListener('touchstart', function(e) {
            // Проверяем, что нажатие было на сообщении, а не на аватаре или кнопке
            if (e.target.closest('.message-content') && 
                !e.target.closest('.message-reply-btn') && 
                !e.target.closest('.mini-reply-btn') && 
                !e.target.closest('.reply-info')) {
                
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                
                pressTimer = setTimeout(function() {
                    showContextMenu(e, messageElement);
                }, longPressThreshold);
            }
        }, { passive: false });
        
        messageElement.addEventListener('touchmove', function(e) {
            // Отменяем длительное нажатие, если пользователь двигает палец более чем на 10px
            const moveX = Math.abs(e.touches[0].clientX - startX);
            const moveY = Math.abs(e.touches[0].clientY - startY);
            
            if (moveX > 10 || moveY > 10) {
                clearTimeout(pressTimer);
            }
        }, { passive: true });
        
        messageElement.addEventListener('touchend', function() {
            clearTimeout(pressTimer);
        }, { passive: true });
    }
    
    // Функция для форматирования времени сообщения
    function formatMessageTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        // Если сообщение от сегодня, показываем только время
        if (date >= today) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        // Если сообщение от вчера, показываем "Вчера" и время
        if (date >= yesterday) {
            return `Вчера, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
        
        // Иначе показываем дату и время
        return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + 
               date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Функция для генерации случайного цвета на основе имени
    function getRandomColor(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        const colors = [
            '#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6',
            '#1abc9c', '#d35400', '#c0392b', '#16a085', '#8e44ad',
            '#27ae60', '#2980b9', '#f1c40f', '#e67e22', '#2c3e50'
        ];
        
        return colors[Math.abs(hash) % colors.length];
    }
    
    // Функция для ответа на сообщение
    function replyToMessageHandler(messageElement) {
        // Получаем данные сообщения
        const messageId = messageElement.dataset.id;
        const authorName = messageElement.dataset.author || messageElement.querySelector('.message-author').textContent;
        const messageText = messageElement.dataset.text || messageElement.querySelector('.message-text').textContent;
        
        // Сохраняем данные в элементе для последующего использования
        messageElement.dataset.author = authorName;
        messageElement.dataset.text = messageText;
        
        console.log('Ответ на сообщение:', { id: messageId, author: authorName, text: messageText });
        
        // Удаляем существующий блок ответа, если он есть
        const existingReplyBlock = document.querySelector('.replying-to');
        if (existingReplyBlock) {
            existingReplyBlock.remove();
        }
        
        // Создаем блок ответа
        const replyBlock = document.createElement('div');
        replyBlock.className = 'replying-to';
        replyBlock.dataset.id = messageId;
        replyBlock.dataset.author = authorName;
        replyBlock.dataset.text = messageText;
        
        // Создаем содержимое блока ответа
        replyBlock.innerHTML = `
            <div class="reply-header">
                <span class="reply-title"><i class="fas fa-reply"></i> Ответ для ${authorName}</span>
                <button class="cancel-reply-btn"><i class="fas fa-times"></i></button>
            </div>
            <div class="reply-text">${messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText}</div>
        `;
        
        // Добавляем блок ответа перед полем ввода
        const chatForm = document.querySelector('.chat-form');
        chatForm.insertBefore(replyBlock, chatForm.firstChild);
        
        // Добавляем обработчик для кнопки отмены ответа
        const cancelReplyBtn = replyBlock.querySelector('.cancel-reply-btn');
        cancelReplyBtn.addEventListener('click', function() {
            replyBlock.remove();
        });
        
        // Фокусируемся на поле ввода
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.focus();
        }
    }
    
    // Функция для подписки на новые сообщения
    function subscribeToNewMessages() {
        if (chatSubscription) {
            chatSubscription.unsubscribe();
        }
        
        chatSubscription = supabase
            .channel('chat_messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
                const newMessage = payload.new;
                
                // Если чат открыт, отображаем сообщение
                if (chatModal.classList.contains('active')) {
                    // Скрываем заглушку пустого чата, если это первое сообщение
                    if (messagesCount === 0) {
                        emptyChat.classList.add('hidden');
                    }
                    
                    // Отображаем новое сообщение
                    displayMessage(newMessage);
                    messagesCount++;
                    
                    // Обновляем временную метку самого нового сообщения
                    newestMessageTimestamp = newMessage.created_at;
                } else {
                    // Если чат закрыт, увеличиваем счетчик непрочитанных сообщений
                    unreadMessages++;
                    updateNotificationBadge();
                    
                    // Показываем уведомление о новом сообщении
                    showNotification(newMessage);
                }
            })
            .subscribe();
    }
    
    // Функция для показа уведомления о новом сообщении
    function showNotification(message) {
        // Проверяем поддержку уведомлений
        if (!('Notification' in window)) {
            return;
        }
        
        // Запрашиваем разрешение на показ уведомлений
        if (Notification.permission === 'granted') {
            const notification = new Notification('Новое сообщение в чате', {
                body: `${message.author_name}: ${message.message}`,
                icon: '/icons/icon-192x192.png'
            });
            
            notification.onclick = function() {
                window.focus();
                openChat();
                this.close();
            };
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }
    
    // Функция для показа сообщения об ошибке
    function showMessage(text) {
        const messageElement = document.createElement('div');
        messageElement.className = 'system-message';
        messageElement.textContent = text;
        
        messagesList.appendChild(messageElement);
        
        setTimeout(() => {
            messageElement.remove();
        }, 5000);
    }
    
    // Функция для показа модального окна ввода имени
    function showNameModal() {
        console.log('Вызвана функция showNameModal()');
        const nameModal = document.getElementById('name-modal');
        if (nameModal) {
            console.log('Модальное окно имени найдено, показываем');
            nameModal.classList.remove('hidden');
        } else {
            console.error('Модальное окно имени не найдено!');
        }
    }
    
    // Обработчики событий
    
    // Открытие чата
    if (chatButton) {
        console.log('Кнопка чата найдена, добавляем обработчик клика');
        
        // Удаляем все существующие обработчики
        chatButton.removeEventListener('click', openChat);
        
        // Добавляем прямой обработчик
        chatButton.onclick = function() {
            console.log('Кнопка чата нажата (через onclick)');
            openChat();
        };
        
        // Добавляем также через addEventListener для надежности
        chatButton.addEventListener('click', function() {
            console.log('Кнопка чата нажата (через addEventListener)');
            openChat();
        });
        
        // Для полной уверенности добавим обработчик через jQuery, если он доступен
        console.log('Добавляем обработчик через jQuery, если доступен');
        if (window.jQuery) {
            try {
                jQuery(chatButton).on('click', function() {
                    console.log('Кнопка чата нажата (через jQuery)');
                    openChat();
                });
            } catch (e) {
                console.error('Ошибка при добавлении обработчика через jQuery:', e);
            }
        }
    } else {
        console.error('Кнопка чата не найдена в DOM!');
    }
    
    // Закрытие чата
    closeChat.addEventListener('click', closeChat);
    
    // Закрытие чата при клике вне контейнера
    chatModal.addEventListener('click', function(event) {
        if (event.target === chatModal) {
            closeChat();
        }
    });
    
    // Отправка сообщения при нажатии на кнопку
    if (sendMessageBtn) {
        console.log('Кнопка отправки сообщения найдена');
        
        // Удаляем все существующие обработчики
        const newSendBtn = sendMessageBtn.cloneNode(true);
        sendMessageBtn.parentNode.replaceChild(newSendBtn, sendMessageBtn);
        
        // Обновляем ссылку на кнопку
        sendMessageBtn = newSendBtn;
        
        // Добавляем прямой обработчик
        sendMessageBtn.onclick = function(e) {
            console.log('Кнопка отправки сообщения нажата (через onclick)');
            e.preventDefault();
            sendMessage();
            return false;
        };
        
        // Добавляем также через addEventListener для надежности
        sendMessageBtn.addEventListener('click', function(e) {
            console.log('Кнопка отправки сообщения нажата (через addEventListener)');
            e.preventDefault();
            sendMessage();
            return false;
        });
    } else {
        console.error('Кнопка отправки сообщения не найдена!');
    }
    
    // Отправка сообщения при нажатии Enter
    if (chatInput) {
        console.log('Поле ввода сообщения найдено');
        
        // Удаляем все существующие обработчики
        const newChatInput = chatInput.cloneNode(true);
        chatInput.parentNode.replaceChild(newChatInput, chatInput);
        
        // Обновляем ссылку на поле ввода
        chatInput = newChatInput;
        
        // Добавляем обработчик для нажатия Enter
        chatInput.onkeypress = function(event) {
            if (event.key === 'Enter') {
                console.log('Нажата клавиша Enter в поле ввода (через onkeypress)');
                event.preventDefault();
                sendMessage();
                return false;
            }
        };
        
        // Добавляем также через addEventListener для надежности
        chatInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                console.log('Нажата клавиша Enter в поле ввода (через addEventListener)');
                event.preventDefault();
                sendMessage();
                return false;
            }
        });
        
        // Активация/деактивация кнопки отправки в зависимости от наличия текста
        chatInput.addEventListener('input', function() {
            sendMessageBtn.disabled = !this.value.trim();
        });
    } else {
        console.error('Поле ввода сообщения не найдено!');
    }
    
    // Загрузка предыдущих сообщений
    loadMoreBtn.addEventListener('click', loadMoreMessages);
    
    // Проверка прокрутки для загрузки предыдущих сообщений
    chatMessages.addEventListener('scroll', function() {
        // Если пользователь прокрутил до верха и есть еще сообщения для загрузки
        if (chatMessages.scrollTop === 0 && !isLoadingMore && messagesCount >= 99) {
            loadMoreMessages();
        }
    });
    
    // Инициализация имени пользователя из localStorage или из куки
    function initAuthorName() {
        console.log('Инициализация имени пользователя');
        
        // Проверяем глобальную переменную из script.js
        if (window.authorName) {
            authorName = window.authorName;
            console.log('Имя из глобальной переменной script.js:', authorName);
            
            // Сохраняем в localStorage для совместимости
            localStorage.setItem('author_name', authorName);
            return true;
        }
        
        // Проверяем localStorage
        authorName = localStorage.getItem('author_name');
        console.log('Имя из localStorage:', authorName);
        
        // Если имя не найдено, проверяем куки
        if (!authorName) {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.startsWith('author_name=')) {
                    authorName = decodeURIComponent(cookie.substring('author_name='.length));
                    // Сохраняем имя в localStorage для будущего использования
                    localStorage.setItem('author_name', authorName);
                    console.log('Имя из cookie:', authorName);
                    break;
                }
            }
        }
        
        // Если имя найдено, используем его
        if (authorName) {
            console.log('Имя пользователя найдено:', authorName);
            return true;
        } else {
            console.log('Имя пользователя не найдено');
            return false;
        }
    }
    
    // Инициализируем имя пользователя при загрузке страницы
    initAuthorName();
    
    // Запрашиваем разрешение на показ уведомлений
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        setTimeout(() => {
            Notification.requestPermission();
        }, 5000);
    }
    
    // Обновляем обработчики событий для поля ввода
    if (chatInput) {
        // Обработчик нажатия клавиш в поле ввода
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            } else if (e.key === 'Escape') {
                // Отменяем ответ при нажатии Escape
                cancelReply();
            }
        });
        
        // Автоматическое изменение высоты поля ввода
        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            sendMessageBtn.disabled = !this.value.trim();
        });
    }
    
    // Обработчик для кнопки отправки сообщения
    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', sendMessage);
    }
});

// Обработчик события для модального окна ввода имени
document.addEventListener('DOMContentLoaded', function() {
    const submitNameBtn = document.getElementById('submit-name');
    
    if (submitNameBtn) {
        submitNameBtn.addEventListener('click', function() {
            const authorNameInput = document.getElementById('author-name');
            const nameError = document.getElementById('name-error');
            const nameModal = document.getElementById('name-modal');
            
            const name = authorNameInput.value.trim();
            
            if (name) {
                // Сохраняем имя в localStorage и куки
                localStorage.setItem('author_name', name);
                document.cookie = `author_name=${encodeURIComponent(name)}; max-age=${60*60*24*365}; path=/`;
                
                // Закрываем модальное окно
                nameModal.classList.add('hidden');
                
                // Открываем чат, если он был вызван
                const chatModal = document.getElementById('chat-modal');
                if (chatModal) {
                    chatModal.classList.add('active');
                    const chatContainer = document.getElementById('chat-container');
                    if (chatContainer) {
                        chatContainer.classList.add('slide-in');
                        chatContainer.classList.remove('slide-out');
                    }
                    
                    // Загружаем сообщения
                    if (typeof window.openChat === 'function') {
                        window.openChat();
                    }
                }
            } else {
                // Показываем ошибку
                nameError.classList.remove('hidden');
            }
        });
    }
});

// Модифицируем функцию отправки сообщения для поддержки ответов
async function sendMessage() {
    const messageText = chatInput.value.trim();
    
    if (!messageText) return;
    
    // Очищаем поле ввода
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendMessageBtn.disabled = true;
    
    // Проверяем, прошло ли достаточно времени с момента последнего сообщения
    const now = new Date();
    if (lastMessageTime && (now - lastMessageTime) < 1000) {
        // Если прошло меньше 1 секунды, показываем сообщение
        showMessage('Слишком частая отправка сообщений. Пожалуйста, подождите немного.');
        return;
    }
    
    // Добавляем эффект отправки сообщения
    const sendingIndicator = document.createElement('div');
    sendingIndicator.className = 'system-message';
    sendingIndicator.innerHTML = '<i class="fas fa-paper-plane"></i> Отправка сообщения...';
    sendingIndicator.style.opacity = '0';
    messagesList.appendChild(sendingIndicator);
    
    // Анимируем индикатор отправки
    setTimeout(() => {
        sendingIndicator.style.transition = 'opacity 0.3s ease';
        sendingIndicator.style.opacity = '1';
    }, 10);
    
    try {
        // Создаем объект сообщения
        const messageData = {
            author_name: authorName,
            message: messageText
        };
        
        // Если это ответ на сообщение, добавляем соответствующие поля
        if (replyToMessage) {
            messageData.reply_to_id = replyToMessage.id;
            messageData.reply_to_author = replyToMessage.author;
            messageData.reply_to_text = replyToMessage.text;
            
            // Отменяем режим ответа
            cancelReply();
        }
        
        // Отправляем сообщение
        const { data, error } = await supabase
            .from('chat_messages')
            .insert([messageData]);
            
        if (error) {
            // Удаляем индикатор отправки
            sendingIndicator.remove();
            
            console.error('Ошибка при отправке сообщения:', error);
            showMessage('Не удалось отправить сообщение. Пожалуйста, попробуйте позже.');
            return;
        }
        
        // Удаляем индикатор отправки
        sendingIndicator.remove();
        
        console.log('Сообщение успешно отправлено:', data);
        
        // Обновляем время последнего сообщения
        lastMessageTime = now;
        
        // Показываем анимацию успеха
        const successIndicator = document.createElement('div');
        successIndicator.className = 'system-message';
        successIndicator.innerHTML = '<i class="fas fa-check-circle"></i> Сообщение отправлено';
        successIndicator.style.backgroundColor = 'rgba(76, 175, 80, 0.15)';
        successIndicator.style.color = '#4caf50';
        successIndicator.style.borderLeft = '3px solid #4caf50';
        messagesList.appendChild(successIndicator);
        
        // Удаляем индикатор успеха через 2 секунды
        setTimeout(() => {
            successIndicator.style.transition = 'opacity 0.3s ease';
            successIndicator.style.opacity = '0';
            setTimeout(() => successIndicator.remove(), 300);
        }, 2000);
        
        // Фокус на поле ввода
        chatInput.focus();
    } catch (error) {
        // Удаляем индикатор отправки
        sendingIndicator.remove();
        
        console.error('Ошибка при отправке сообщения:', error);
        showMessage('Не удалось отправить сообщение. Пожалуйста, попробуйте позже.');
    }
}