// Простой скрипт для отправки сообщений в чате
document.addEventListener('DOMContentLoaded', function() {
    console.log('simple-chat-send.js загружен');
    
    // Находим элементы формы отправки сообщений
    const chatInput = document.getElementById('chat-input');
    const sendMessageBtn = document.getElementById('send-message-btn');
    const messagesList = document.getElementById('messages-list');
    const emptyChat = document.getElementById('empty-chat');
    const chatModal = document.getElementById('chat-modal');
    const chatContainer = document.getElementById('chat-container');
    
    if (!chatInput || !sendMessageBtn || !messagesList) {
        console.error('Элементы чата не найдены!');
        return;
    }
    
    console.log('Элементы чата найдены');
    
    // Устанавливаем высокий z-index для модального окна и контейнера чата
    if (chatModal) {
        chatModal.style.zIndex = '99999';
    }
    if (chatContainer) {
        chatContainer.style.zIndex = '100000';
    }
    
    // Переменная для хранения имени пользователя
    let currentUserName = '';
    
    // Инициализируем имя пользователя и загружаем сообщения
    initUserName().then(() => {
        loadMessages();
    });
    
    // Функция для инициализации имени пользователя
    async function initUserName() {
        console.log('Инициализация имени пользователя...');
        
        // Проверяем, есть ли имя в localStorage
        const storedName = localStorage.getItem('author_name');
        if (storedName) {
            console.log('Имя найдено в localStorage:', storedName);
            currentUserName = storedName;
            return;
        }
        
        try {
            // Получаем IP пользователя
            const userIP = await getUserIP();
            console.log('IP пользователя:', userIP);
            
            // Если Supabase доступен, пытаемся найти пользователя по IP
            if (window.supabaseClient && userIP) {
                try {
                    const { data, error } = await window.supabaseClient
                        .from('users')
                        .select('name')
                        .eq('ip_address', userIP)
                        .limit(1);
                    
                    if (!error && data && data.length > 0) {
                        currentUserName = data[0].name;
                        console.log('Имя получено из базы данных:', currentUserName);
                        localStorage.setItem('author_name', currentUserName);
                        return;
                    }
                } catch (dbError) {
                    console.error('Ошибка при поиске пользователя в базе:', dbError);
                }
            }
            
            // Если имя не найдено, запрашиваем его у пользователя
            const userName = prompt('Пожалуйста, введите ваше имя:', '');
            if (userName) {
                currentUserName = userName;
                localStorage.setItem('author_name', currentUserName);
                
                // Если Supabase доступен, сохраняем пользователя
                if (window.supabaseClient && userIP) {
                    try {
                        await window.supabaseClient
                            .from('users')
                            .insert([{ name: currentUserName, ip_address: userIP }]);
                        console.log('Пользователь сохранен в базе данных');
                    } catch (insertError) {
                        console.error('Ошибка при сохранении пользователя:', insertError);
                    }
                }
            } else {
                // Если пользователь не ввел имя, используем имя по умолчанию
                currentUserName = 'Пользователь_' + Math.floor(Math.random() * 10000);
                localStorage.setItem('author_name', currentUserName);
            }
        } catch (error) {
            console.error('Ошибка при инициализации имени пользователя:', error);
            // Используем имя по умолчанию
            currentUserName = 'Пользователь_' + Math.floor(Math.random() * 10000);
            localStorage.setItem('author_name', currentUserName);
        }
    }
    
    // Функция для получения IP пользователя
    async function getUserIP() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip;
        } catch (error) {
            console.error('Ошибка при получении IP:', error);
            return null;
        }
    }
    
    // Функция для загрузки сообщений
    function loadMessages() {
        console.log('Загрузка сообщений...');
        
        if (!window.supabaseClient) {
            console.error('Supabase клиент недоступен!');
            showSimpleMessage('Ошибка загрузки сообщений. Сервис недоступен.');
            return;
        }
        
        // Показываем индикатор загрузки
        messagesList.innerHTML = '<div class="loading-messages"><i class="fas fa-spinner fa-spin"></i> Загрузка сообщений...</div>';
        
        // Запрашиваем последние 99 сообщений
        window.supabaseClient
            .from('chat_messages')
            .select('*')
            .order('created_at', { ascending: true }) // От старых к новым
            .limit(99)
            .then(response => {
                // Очищаем список сообщений
                messagesList.innerHTML = '';
                
                if (response.error) {
                    console.error('Ошибка при загрузке сообщений:', response.error);
                    showSimpleMessage('Не удалось загрузить сообщения. Пожалуйста, попробуйте позже.');
                    return;
                }
                
                const data = response.data;
                
                if (data && data.length > 0) {
                    // Скрываем заглушку пустого чата
                    if (emptyChat) emptyChat.classList.add('hidden');
                    
                    // Отображаем сообщения
                    data.forEach(message => {
                        displayMessage(message);
                    });
                    
                    // Прокручиваем чат вниз
                    const chatMessages = document.getElementById('chat-messages');
                    if (chatMessages) {
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }
                } else {
                    // Показываем заглушку пустого чата
                    if (emptyChat) emptyChat.classList.remove('hidden');
                }
                
                // Подписываемся на новые сообщения
                subscribeToMessages();
            })
            .catch(error => {
                console.error('Ошибка при загрузке сообщений:', error);
                messagesList.innerHTML = '<div class="error-message">Не удалось загрузить сообщения. Пожалуйста, попробуйте позже.</div>';
            });
    }
    
    // Функция для подписки на новые сообщения
    function subscribeToMessages() {
        console.log('Подписка на новые сообщения...');
        
        if (!window.supabaseClient) return;
        
        const subscription = window.supabaseClient
            .channel('chat_messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
                console.log('Новое сообщение получено:', payload);
                const newMessage = payload.new;
                
                // Отображаем новое сообщение
                displayMessage(newMessage);
                
                // Скрываем заглушку пустого чата, если она видна
                if (emptyChat) emptyChat.classList.add('hidden');
                
                // Прокручиваем чат вниз
                const chatMessages = document.getElementById('chat-messages');
                if (chatMessages) {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            })
            .subscribe();
        
        console.log('Подписка на сообщения активирована');
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
        
        // Создаем текст сообщения
        const text = document.createElement('div');
        text.className = 'message-text';
        text.textContent = message.message;
        
        // Собираем сообщение
        content.appendChild(header);
        content.appendChild(text);
        
        messageElement.appendChild(avatar);
        messageElement.appendChild(content);
        
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
    
    // Функция для отправки сообщения
    function simpleSendMessage() {
        const messageText = chatInput.value.trim();
        
        if (!messageText) {
            console.log('Пустое сообщение, не отправляем');
            return;
        }
        
        console.log('Отправка сообщения:', messageText);
        
        // Используем имя пользователя
        const authorName = currentUserName || localStorage.getItem('author_name') || 'Пользователь';
        console.log('Автор:', authorName);
        
        // Очищаем поле ввода сразу
        chatInput.value = '';
        sendMessageBtn.disabled = true;
        
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
        
        // Проверяем доступность Supabase
        if (!window.supabaseClient) {
            console.error('Supabase клиент недоступен!');
            showSimpleMessage('Ошибка отправки сообщения. Сервис недоступен.');
            sendingIndicator.remove();
            return;
        }
        
        // Подготавливаем данные сообщения
        const messageData = {
            author_name: authorName,
            message: messageText
        };
        
        // Если это ответ на сообщение, добавляем информацию о нем
        const replyingToElement = document.querySelector('.replying-to');
        if (replyingToElement && replyingToElement.dataset.id) {
            messageData.reply_to_id = replyingToElement.dataset.id;
            messageData.reply_to_author = replyingToElement.dataset.author;
            messageData.reply_to_text = replyingToElement.dataset.text;
            
            // Убираем блок ответа
            replyingToElement.remove();
        }
        
        // Отправляем сообщение в базу данных
        window.supabaseClient
            .from('chat_messages')
            .insert([messageData])
            .then(response => {
                // Удаляем индикатор отправки
                sendingIndicator.remove();
                
                if (response.error) {
                    console.error('Ошибка при отправке сообщения:', response.error);
                    showSimpleMessage('Не удалось отправить сообщение. Пожалуйста, попробуйте позже.');
                } else {
                    console.log('Сообщение успешно отправлено:', response.data);
                    
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
                }
            })
            .catch(error => {
                // Удаляем индикатор отправки
                sendingIndicator.remove();
                
                console.error('Ошибка при отправке сообщения:', error);
                showSimpleMessage('Не удалось отправить сообщение. Пожалуйста, попробуйте позже.');
            });
    }
    
    // Функция для показа сообщения об ошибке
    function showSimpleMessage(text) {
        if (!messagesList) return;
        
        const messageElement = document.createElement('div');
        messageElement.className = 'system-message';
        messageElement.textContent = text;
        
        messagesList.appendChild(messageElement);
        
        setTimeout(() => {
            messageElement.remove();
        }, 5000);
    }
    
    // Добавляем обработчики событий
    
    // Прямой обработчик для кнопки
    sendMessageBtn.onclick = function(e) {
        console.log('Кнопка отправки нажата (simple-chat-send.js)');
        e.preventDefault();
        simpleSendMessage();
        return false;
    };
    
    // Обработчик для нажатия Enter
    chatInput.onkeypress = function(event) {
        if (event.key === 'Enter') {
            console.log('Нажата клавиша Enter (simple-chat-send.js)');
            event.preventDefault();
            simpleSendMessage();
            return false;
        }
    };
    
    // Активация/деактивация кнопки отправки
    chatInput.oninput = function() {
        sendMessageBtn.disabled = !this.value.trim();
    };
}); 