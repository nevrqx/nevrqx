// Скрипт для добавления кнопки чата с инлайн-стилями
document.addEventListener('DOMContentLoaded', function() {
    console.log('inline-chat-button.js загружен');
    
    // Удаляем существующую кнопку чата, если она есть
    const existingButton = document.getElementById('chat-button');
    if (existingButton) {
        existingButton.remove();
    }
    
    // Создаем новую кнопку чата с инлайн-стилями
    const chatButton = document.createElement('button');
    chatButton.id = 'chat-button-inline';
    chatButton.title = 'Открыть чат';
    chatButton.innerHTML = '<i class="fas fa-comments" style="font-size: 28px;"></i><span style="position: absolute; top: -5px; right: -5px; background-color: #e74c3c; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; justify-content: center; align-items: center; font-size: 12px; font-weight: bold;">0</span>';
    
    // Применяем инлайн-стили
    chatButton.style.position = 'fixed';
    chatButton.style.bottom = '20px';
    chatButton.style.right = '20px';
    chatButton.style.width = '70px';
    chatButton.style.height = '70px';
    chatButton.style.borderRadius = '50%';
    chatButton.style.backgroundColor = '#ff3030';
    chatButton.style.color = 'white';
    chatButton.style.border = 'none';
    chatButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 4px rgba(255, 48, 48, 0.4)';
    chatButton.style.display = 'flex';
    chatButton.style.justifyContent = 'center';
    chatButton.style.alignItems = 'center';
    chatButton.style.cursor = 'pointer';
    chatButton.style.zIndex = '10000';
    chatButton.style.transition = 'all 0.3s ease';
    chatButton.style.animation = 'pulse 1.5s infinite';
    
    // Добавляем кнопку в body
    document.body.appendChild(chatButton);
    
    // Добавляем стили для анимации
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0% {
                transform: scale(1);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 0 rgba(255, 48, 48, 0.7);
            }
            50% {
                transform: scale(1.1);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 15px rgba(255, 48, 48, 0);
            }
            100% {
                transform: scale(1);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 0 rgba(255, 48, 48, 0);
            }
        }
    `;
    document.head.appendChild(style);
    
    // Добавляем обработчик клика
    chatButton.addEventListener('click', function(event) {
        console.log('Инлайн кнопка чата нажата!');
        event.preventDefault();
        
        // Получаем модальное окно чата
        const chatModal = document.getElementById('chat-modal');
        if (chatModal) {
            console.log('Показываем модальное окно чата');
            chatModal.style.opacity = '1';
            chatModal.style.visibility = 'visible';
            chatModal.classList.add('active');
            
            const chatContainer = document.getElementById('chat-container');
            if (chatContainer) {
                chatContainer.classList.add('slide-in');
                chatContainer.classList.remove('slide-out');
            }
        } else {
            console.error('Модальное окно чата не найдено!');
            alert('Чат временно недоступен. Пожалуйста, попробуйте позже.');
        }
        
        return false;
    });
});

// Дополнительный скрипт для обработки кнопки чата
document.addEventListener('DOMContentLoaded', function() {
    console.log('inline-chat-button.js загружен');
    
    // Находим кнопки чата
    const chatButton = document.getElementById('chat-button');
    const mobileChatButton = document.getElementById('mobile-chat-button');
    const chatModal = document.getElementById('chat-modal');
    
    // Функция для скрытия кнопок чата
    function hideChatButtons() {
        console.log('Скрываем кнопки чата из inline-chat-button.js');
        if (chatButton) {
            chatButton.style.display = 'none';
            chatButton.style.opacity = '0';
            chatButton.style.visibility = 'hidden';
            chatButton.style.pointerEvents = 'none';
        }
        
        if (mobileChatButton) {
            mobileChatButton.style.display = 'none';
            mobileChatButton.style.opacity = '0';
            mobileChatButton.style.visibility = 'hidden';
            mobileChatButton.style.pointerEvents = 'none';
        }
    }
    
    // Функция для показа кнопок чата
    function showChatButtons() {
        console.log('Показываем кнопки чата из inline-chat-button.js');
        
        // Определяем, на каком устройстве мы находимся
        const isMobile = window.innerWidth <= 767;
        
        if (isMobile) {
            // На мобильном показываем верхнюю кнопку
            if (mobileChatButton) {
                mobileChatButton.style.display = 'flex';
                mobileChatButton.style.opacity = '1';
                mobileChatButton.style.visibility = 'visible';
                mobileChatButton.style.pointerEvents = 'auto';
            }
            
            // Скрываем нижнюю кнопку на мобильном
            if (chatButton) {
                chatButton.style.display = 'none';
            }
        } else {
            // На ПК показываем нижнюю кнопку
            if (chatButton) {
                chatButton.style.display = 'flex';
                chatButton.style.opacity = '1';
                chatButton.style.visibility = 'visible';
                chatButton.style.pointerEvents = 'auto';
            }
            
            // Скрываем верхнюю кнопку на ПК
            if (mobileChatButton) {
                mobileChatButton.style.display = 'none';
            }
        }
    }
    
    // Наблюдаем за изменениями класса модального окна
    if (chatModal) {
        // Создаем наблюдатель за атрибутами
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.attributeName === 'class') {
                    // Проверяем наличие класса active
                    if (chatModal.classList.contains('active')) {
                        hideChatButtons();
                    } else {
                        setTimeout(function() {
                            showChatButtons();
                        }, 300);
                    }
                }
            });
        });
        
        // Настраиваем наблюдатель
        observer.observe(chatModal, { attributes: true });
        
        // Проверяем начальное состояние
        if (chatModal.classList.contains('active')) {
            hideChatButtons();
        } else {
            showChatButtons();
        }
    }
    
    // Наблюдаем за изменением размера окна для адаптивности
    window.addEventListener('resize', function() {
        if (!chatModal || !chatModal.classList.contains('active')) {
            showChatButtons();
        }
    });
    
    // Добавляем обработчики событий для кнопок чата
    const addClickHandler = function(button) {
        if (button) {
            button.addEventListener('click', function() {
                hideChatButtons();
                if (typeof window.openChat === 'function') {
                    window.openChat();
                }
            });
        }
    };
    
    // Добавляем обработчики для обеих кнопок
    addClickHandler(chatButton);
    addClickHandler(mobileChatButton);
    
    // Инициализируем правильное отображение кнопок при загрузке
    showChatButtons();
}); 