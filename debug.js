// Скрипт для отладки проблем с чатом
document.addEventListener('DOMContentLoaded', function() {
    console.log('debug.js загружен');
    
    // Проверяем наличие всех необходимых элементов
    const elements = {
        'chat-button': document.getElementById('chat-button'),
        'chat-modal': document.getElementById('chat-modal'),
        'chat-container': document.getElementById('chat-container'),
        'close-chat': document.getElementById('close-chat'),
        'chat-messages': document.getElementById('chat-messages'),
        'messages-list': document.getElementById('messages-list'),
        'chat-input': document.getElementById('chat-input'),
        'send-message-btn': document.getElementById('send-message-btn')
    };
    
    console.log('Проверка элементов:');
    let allFound = true;
    for (const [id, element] of Object.entries(elements)) {
        if (!element) {
            console.error(`Элемент #${id} не найден!`);
            allFound = false;
        } else {
            console.log(`Элемент #${id} найден`);
        }
    }
    
    if (!allFound) {
        console.error('Не все элементы найдены, чат может работать некорректно');
    }
    
    // Проверяем доступность Supabase
    if (window.supabaseClient) {
        console.log('Supabase клиент доступен');
    } else {
        console.error('Supabase клиент не доступен!');
    }
    
    // Проверяем доступность функций чата
    if (typeof window.openChat === 'function') {
        console.log('Функция openChat доступна');
    } else {
        console.error('Функция openChat не доступна!');
    }
    
    if (typeof window.closeChat === 'function') {
        console.log('Функция closeChat доступна');
    } else {
        console.error('Функция closeChat не доступна!');
    }
    
    // Добавляем отладочный обработчик для кнопки чата
    const chatButton = document.getElementById('chat-button');
    if (chatButton) {
        // Добавляем дополнительный обработчик для отладки
        chatButton.addEventListener('click', function(event) {
            console.log('DEBUG: Кнопка чата нажата!');
            console.log('DEBUG: Текущие стили кнопки:', window.getComputedStyle(chatButton));
            
            // Принудительно показываем модальное окно чата
            const chatModal = document.getElementById('chat-modal');
            if (chatModal) {
                console.log('DEBUG: Принудительно показываем модальное окно чата');
                chatModal.style.opacity = '1';
                chatModal.style.visibility = 'visible';
                chatModal.classList.add('active');
                
                const chatContainer = document.getElementById('chat-container');
                if (chatContainer) {
                    chatContainer.classList.add('slide-in');
                    chatContainer.classList.remove('slide-out');
                }
            }
        });
    }
    
    // Добавляем глобальный обработчик ошибок
    window.addEventListener('error', function(event) {
        console.error('Поймана ошибка:', event.error);
    });
}); 