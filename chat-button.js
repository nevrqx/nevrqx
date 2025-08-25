// Простой скрипт для обработки клика на кнопке чата
document.addEventListener('DOMContentLoaded', function() {
    console.log('chat-button.js загружен');
    
    // Находим кнопки чата
    const chatButton = document.getElementById('chat-button');
    const mobileChatButton = document.getElementById('mobile-chat-button');
    const chatModal = document.getElementById('chat-modal');
    const chatContainer = document.getElementById('chat-container');
    
    // Функция для скрытия кнопок чата
    function hideChatButtons() {
        if (chatButton) {
            console.log('Скрываем основную кнопку чата из chat-button.js');
            chatButton.style.display = 'none';
            chatButton.style.opacity = '0';
            chatButton.style.visibility = 'hidden';
            chatButton.style.pointerEvents = 'none';
        }
        
        if (mobileChatButton) {
            console.log('Скрываем мобильную кнопку чата из chat-button.js');
            mobileChatButton.style.display = 'none';
            mobileChatButton.style.opacity = '0';
            mobileChatButton.style.visibility = 'hidden';
            mobileChatButton.style.pointerEvents = 'none';
        }
    }
    
    // Функция для показа кнопок чата
    function showChatButtons() {
        // Определяем, на каком устройстве мы находимся
        const isMobile = window.innerWidth <= 767;
        
        if (isMobile) {
            // На мобильном показываем верхнюю кнопку
            if (mobileChatButton) {
                console.log('Показываем мобильную кнопку чата из chat-button.js');
                mobileChatButton.style.display = 'flex';
                mobileChatButton.style.opacity = '1';
                mobileChatButton.style.visibility = 'visible';
                mobileChatButton.style.pointerEvents = 'auto';
            }
        } else {
            // На ПК показываем нижнюю кнопку
            if (chatButton) {
                console.log('Показываем основную кнопку чата из chat-button.js');
                chatButton.style.display = 'flex';
                chatButton.style.opacity = '1';
                chatButton.style.visibility = 'visible';
                chatButton.style.pointerEvents = 'auto';
            }
        }
    }
    
    // Проверяем, открыт ли чат
    if (chatModal && chatModal.classList.contains('active')) {
        hideChatButtons();
    } else {
        showChatButtons();
    }
    
    // Наблюдаем за изменениями класса модального окна
    if (chatModal) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.attributeName === 'class') {
                    if (chatModal.classList.contains('active')) {
                        hideChatButtons();
                    } else {
                        showChatButtons();
                    }
                }
            });
        });
        
        observer.observe(chatModal, { attributes: true });
    }
    
    // Наблюдаем за изменением размера окна для адаптивности
    window.addEventListener('resize', function() {
        if (!chatModal.classList.contains('active')) {
            showChatButtons();
        }
    });
    
    // Обработчики для кнопки чата на ПК
    if (chatButton && chatModal) {
        console.log('Кнопка чата и модальное окно найдены');
        
        // Прямой обработчик клика
        chatButton.onclick = function(event) {
            console.log('Кнопка чата нажата!');
            event.preventDefault();
            
            // Скрываем кнопки чата
            hideChatButtons();
            
            // Используем глобальную функцию openChat
            if (typeof window.openChat === 'function') {
                console.log('Вызываем функцию openChat()');
                window.openChat();
            } else {
                console.error('Функция openChat не найдена!');
                
                // Запасной вариант, если функция не найдена
                chatModal.style.opacity = '1';
                chatModal.style.visibility = 'visible';
                chatModal.classList.add('active');
                chatContainer.classList.add('slide-in');
                chatContainer.classList.remove('slide-out');
            }
            
            return false;
        };
    }
    
    // Обработчики для мобильной кнопки чата
    if (mobileChatButton && chatModal) {
        console.log('Мобильная кнопка чата и модальное окно найдены');
        
        // Прямой обработчик клика
        mobileChatButton.onclick = function(event) {
            console.log('Мобильная кнопка чата нажата!');
            event.preventDefault();
            
            // Скрываем кнопки чата
            hideChatButtons();
            
            // Используем глобальную функцию openChat
            if (typeof window.openChat === 'function') {
                console.log('Вызываем функцию openChat()');
                window.openChat();
            } else {
                console.error('Функция openChat не найдена!');
                
                // Запасной вариант, если функция не найдена
                chatModal.style.opacity = '1';
                chatModal.style.visibility = 'visible';
                chatModal.classList.add('active');
                chatContainer.classList.add('slide-in');
                chatContainer.classList.remove('slide-out');
            }
            
            return false;
        };
    }
    
    // Находим кнопку закрытия
    const closeChat = document.getElementById('close-chat');
    if (closeChat && chatModal) {
        closeChat.onclick = function(event) {
            console.log('Кнопка закрытия чата нажата!');
            event.preventDefault();
            
            // Используем глобальную функцию closeChat
            if (typeof window.closeChat === 'function') {
                console.log('Вызываем функцию closeChat()');
                window.closeChat();
            } else {
                console.error('Функция closeChat не найдена!');
                
                // Запасной вариант, если функция не найдена
                chatContainer.classList.remove('slide-in');
                chatContainer.classList.add('slide-out');
                
                setTimeout(() => {
                    chatModal.style.opacity = '0';
                    chatModal.style.visibility = 'hidden';
                    chatModal.classList.remove('active');
                    
                    // Показываем кнопки чата
                    showChatButtons();
                }, 300);
            }
            
            return false;
        };
    }
    
    // Закрытие по клику вне модального окна
    if (chatModal) {
        chatModal.onclick = function(event) {
            if (event.target === chatModal) {
                console.log('Клик вне модального окна чата!');
                
                // Используем глобальную функцию closeChat
                if (typeof window.closeChat === 'function') {
                    console.log('Вызываем функцию closeChat()');
                    window.closeChat();
                } else {
                    console.error('Функция closeChat не найдена!');
                    
                    // Запасной вариант, если функция не найдена
                    chatContainer.classList.remove('slide-in');
                    chatContainer.classList.add('slide-out');
                    
                    setTimeout(() => {
                        chatModal.style.opacity = '0';
                        chatModal.style.visibility = 'hidden';
                        chatModal.classList.remove('active');
                        
                        // Показываем кнопки чата
                        showChatButtons();
                    }, 300);
                }
            }
        };
    }
}); 