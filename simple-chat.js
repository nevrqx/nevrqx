// Простой скрипт для работы чата без зависимостей
document.addEventListener('DOMContentLoaded', function() {
    console.log('simple-chat.js загружен');
    
    // Создаем кнопку чата, если она не существует
    let chatButton = document.getElementById('chat-button');
    if (!chatButton) {
        console.log('Создаем новую кнопку чата');
        chatButton = document.createElement('button');
        chatButton.id = 'chat-button';
        chatButton.className = 'chat-button';
        chatButton.title = 'Открыть чат';
        chatButton.innerHTML = '<i class="fas fa-comments"></i><span id="chat-notification" class="chat-notification">0</span>';
        document.body.appendChild(chatButton);
    }
    
    // Создаем модальное окно чата, если оно не существует
    let chatModal = document.getElementById('chat-modal');
    if (!chatModal) {
        console.log('Создаем новое модальное окно чата');
        chatModal = document.createElement('div');
        chatModal.id = 'chat-modal';
        chatModal.className = 'chat-modal';
        chatModal.innerHTML = `
            <div id="chat-container" class="chat-container">
                <div class="chat-header">
                    <h2><i class="fas fa-comments"></i> Общий чат</h2>
                    <button id="close-chat" class="close-chat" title="Закрыть"><i class="fas fa-times"></i></button>
                </div>
                <div id="chat-messages" class="chat-messages">
                    <div id="load-more-container" class="load-more-container hidden">
                        <button id="load-more-btn" class="load-more-btn">
                            <i class="fas fa-chevron-up"></i> Загрузить предыдущие сообщения
                        </button>
                    </div>
                    <div id="messages-list"></div>
                    <div id="empty-chat" class="empty-chat">
                        <i class="fas fa-comments"></i>
                        <p>Пока нет сообщений. Будьте первым, кто начнет общение!</p>
                    </div>
                </div>
                <div class="chat-input-container">
                    <input type="text" id="chat-input" class="chat-input" placeholder="Введите сообщение..." maxlength="500">
                    <button id="send-message-btn" class="send-message-btn" disabled>
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(chatModal);
    }
    
    // Получаем ссылки на элементы
    const chatContainer = document.getElementById('chat-container');
    const closeChat = document.getElementById('close-chat');
    
    // Обработчик для кнопки чата
    chatButton.onclick = function(event) {
        console.log('Кнопка чата нажата (simple-chat.js)');
        event.preventDefault();
        
        // Показываем модальное окно
        chatModal.style.opacity = '1';
        chatModal.style.visibility = 'visible';
        chatModal.classList.add('active');
        
        // Анимируем контейнер
        if (chatContainer) {
            chatContainer.classList.add('slide-in');
            chatContainer.classList.remove('slide-out');
        }
        
        return false;
    };
    
    // Обработчик для кнопки закрытия
    if (closeChat) {
        closeChat.onclick = function() {
            console.log('Кнопка закрытия чата нажата (simple-chat.js)');
            
            // Анимируем закрытие
            if (chatContainer) {
                chatContainer.classList.remove('slide-in');
                chatContainer.classList.add('slide-out');
            }
            
            // Скрываем модальное окно с задержкой для анимации
            setTimeout(() => {
                chatModal.style.opacity = '0';
                chatModal.style.visibility = 'hidden';
                chatModal.classList.remove('active');
            }, 300);
        };
    }
    
    // Закрытие по клику вне модального окна
    chatModal.onclick = function(event) {
        if (event.target === chatModal) {
            console.log('Клик вне модального окна чата (simple-chat.js)');
            
            // Анимируем закрытие
            if (chatContainer) {
                chatContainer.classList.remove('slide-in');
                chatContainer.classList.add('slide-out');
            }
            
            // Скрываем модальное окно с задержкой для анимации
            setTimeout(() => {
                chatModal.style.opacity = '0';
                chatModal.style.visibility = 'hidden';
                chatModal.classList.remove('active');
            }, 300);
        }
    };
}); 