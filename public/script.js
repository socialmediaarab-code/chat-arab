const socket = io();

// اسم المستخدم
let currentUser = prompt('أدخل اسمك للدخول إلى الدردشة:');
if (!currentUser || currentUser.trim() === '') {
    currentUser = 'زائر_' + Math.floor(Math.random() * 1000);
}

let currentRoom = 'general';
let currentPrivateTargetId = null;
let unreadCount = 0;
const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

// العناصر الرئيسية
const publicMessages = document.getElementById('public-messages');
const publicInput = document.getElementById('public-input');
const usersList = document.getElementById('users-list');
const typingIndicator = document.getElementById('typing-indicator');

// الاتصال وتعميم الانضمام
socket.on('connect', () => {
    socket.emit('join_room', { username: currentUser, room: currentRoom });
});

// تهيئة الإيموجي للشات العام والخاص
window.addEventListener('DOMContentLoaded', () => {
    try {
        if (typeof EmojiButton !== 'undefined') {
            // إيموجي العام
            const publicPicker = new EmojiButton({ position: 'top-start' });
            const publicEmojiBtn = document.getElementById('emoji-btn');
            if (publicEmojiBtn) {
                publicEmojiBtn.addEventListener('click', () => publicPicker.togglePicker(publicEmojiBtn));
                publicPicker.on('emoji', selection => {
                    publicInput.value += selection.emoji;
                });
            }

            // إيموجي الخاص
            const privatePicker = new EmojiButton({ position: 'top-start' });
            const privateEmojiBtn = document.getElementById('private-emoji-btn');
            if (privateEmojiBtn) {
                privateEmojiBtn.addEventListener('click', () => privatePicker.togglePicker(privateEmojiBtn));
                privatePicker.on('emoji', selection => {
                    const privateInp = document.getElementById('private-input');
                    if (privateInp) privateInp.value += selection.emoji;
                });
            }
        }
    } catch (err) {
        console.warn("تنبيه: تعذر تحميل الإيموجي", err);
    }
});

// --- 1. الشات العام ---
function sendPublicMessage() {
    const msg = publicInput.value.trim();
    if (msg) {
        socket.emit('send_message', { room: currentRoom, message: msg });
        publicInput.value = '';
        socket.emit('stop_typing', { room: currentRoom });
    }
}

function sendPublicImage(input) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            socket.emit('send_message', { room: currentRoom, message: '', image: e.target.result });
            input.value = '';
        };
        reader.readAsDataURL(file);
    }
}

if (publicInput) {
    publicInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendPublicMessage();
    });

    let typingTimeout;
    publicInput.addEventListener('input', () => {
        socket.emit('typing', { room: currentRoom });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stop_typing', { room: currentRoom });
        }, 1000);
    });
}

socket.on('chat_message', (data) => {
    const msgDiv = document.createElement('div');
    const isMe = data.username === currentUser;
    msgDiv.className = `msg ${isMe ? 'me' : ''}`;
    
    let content = `<strong>${data.username}:</strong> `;
    if (data.message) content += `<span>${data.message}</span>`;
    if (data.image) content += `<br><img src="${data.image}" class="chat-img" />`;
    
    msgDiv.innerHTML = content;
    publicMessages.appendChild(msgDiv);
    publicMessages.scrollTop = publicMessages.scrollHeight;
});

// --- 2. قائمة المتصلين ---
socket.on('update_users', (users) => {
    usersList.innerHTML = '';
    users.forEach(u => {
        if (u.id !== socket.id) {
            const uDiv = document.createElement('div');
            uDiv.className = 'user-item';
            uDiv.innerText = `👤 ${u.username}`;
            uDiv.onclick = () => openPrivateChat(u.id, u.username);
            usersList.appendChild(uDiv);
        }
    });
});

// --- 3. مؤشر الكتابة ---
socket.on('display_typing', (data) => {
    if (typingIndicator) typingIndicator.innerText = `${data.username} يكتب الآن...`;
});

socket.on('hide_typing', () => {
    if (typingIndicator) typingIndicator.innerText = '';
});

// --- 4. الشات الخاص والنافذة المنبثقة ---
dragElement(document.getElementById("private-chat-modal"));

function dragElement(elmnt) {
    if (!elmnt) return;
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = document.getElementById(elmnt.id + "-header") || elmnt;
    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
        elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function openPrivateChat(targetSocketId, targetUsername) {
    currentPrivateTargetId = targetSocketId;
    document.getElementById('private-target-name').innerText = `محادثة مع: ${targetUsername}`;
    document.getElementById('private-chat-modal').style.display = 'block';
    unreadCount = 0;
    updateBadge();
}

function closePrivateModal() {
    document.getElementById('private-chat-modal').style.display = 'none';
    currentPrivateTargetId = null;
}

// إرسال نص في الخاص
function sendPrivateMessage() {
    const privateInp = document.getElementById('private-input');
    if (!privateInp) return;

    const msg = privateInp.value.trim();
    if (msg && currentPrivateTargetId) {
        socket.emit('send_private_msg', { 
            targetSocketId: currentPrivateTargetId, 
            message: msg 
        });
        appendPrivateMessage('أنت', msg, null, true);
        privateInp.value = '';
    }
}

// الاستماع لزر Enter داخل الخاص
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'private-input') {
        sendPrivateMessage();
    }
});

// إرسال صورة في الخاص
function sendPrivateImage(input) {
    const file = input.files[0];
    if (file && currentPrivateTargetId) {
        const reader = new FileReader();
        reader.onload = function(e) {
            socket.emit('send_private_msg', { 
                targetSocketId: currentPrivateTargetId, 
                message: '', 
                image: e.target.result 
            });
            appendPrivateMessage('أنت', '', e.target.result, true);
            input.value = '';
        };
        reader.readAsDataURL(file);
    }
}

// استقبال الخاص
socket.on('receive_private_msg', (data) => {
    notificationSound.play().catch(() => {});
    const modal = document.getElementById('private-chat-modal');

    if (modal.style.display === 'block' && currentPrivateTargetId === data.senderId) {
        appendPrivateMessage(data.senderName, data.message, data.image, false);
    } else {
        unreadCount++;
        updateBadge();
        openPrivateChat(data.senderId, data.senderName);
        appendPrivateMessage(data.senderName, data.message, data.image, false);
    }
});

function appendPrivateMessage(sender, msg, image, isMe) {
    const msgContainer = document.getElementById('private-messages');
    const msgDiv = document.createElement('div');
    msgDiv.style.alignSelf = isMe ? 'flex-end' : 'flex-start';
    msgDiv.style.backgroundColor = isMe ? '#dcf8c6' : '#fff';
    msgDiv.style.border = '1px solid #ddd';
    msgDiv.style.padding = '6px 10px';
    msgDiv.style.borderRadius = '8px';
    msgDiv.style.maxWidth = '80%';
    msgDiv.style.fontSize = '0.85em';
    
    let content = `<strong>${sender}:</strong> `;
    if (msg) content += `<span>${msg}</span>`;
    if (image) content += `<br><img src="${image}" class="chat-img" />`;

    msgDiv.innerHTML = content;
    msgContainer.appendChild(msgDiv);
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

function updateBadge() {
    const badge = document.getElementById('pm-badge');
    if (badge) {
        if (unreadCount > 0) {
            badge.innerText = unreadCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}
