const socket = io();

let currentUser = prompt('أدخل اسمك للدخول إلى الدردشة:');
if (!currentUser || currentUser.trim() === '') {
    currentUser = 'زائر_' + Math.floor(Math.random() * 1000);
}

let currentRoom = 'general';
let currentPrivateTargetId = null;
let unreadCount = 0;
const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

// تسجيل دخول العميل عند الاتصال مباشرة
socket.on('connect', () => {
    socket.emit('join_room', { username: currentUser, room: currentRoom });
});

const publicMessages = document.getElementById('public-messages');
const publicInput = document.getElementById('public-input');
const privateInput = document.getElementById('private-input');
const usersList = document.getElementById('users-list');
const typingIndicator = document.getElementById('typing-indicator');

// مكتبة الإيموجي
try {
    const picker = new EmojiButton({ position: 'top-start' });
    const emojiBtn = document.getElementById('emoji-btn');
    emojiBtn.addEventListener('click', () => picker.togglePicker(emojiBtn));
    picker.on('emoji', selection => {
        publicInput.value += selection.emoji;
    });
} catch(e) {
    console.log("لم يتم تحميل الإيموجي بشكل صحيح", e);
}

// 1. إرسال واستقبال الشات العام
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

publicInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendPublicMessage();
});

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

// 2. تحديث قائمة المستخدمين المتصلين
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

// 3. مؤشر "يكتب الآن"
let typingTimeout;
publicInput.addEventListener('input', () => {
    socket.emit('typing', { room: currentRoom });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing', { room: currentRoom });
    }, 1000);
});

socket.on('display_typing', (data) => {
    typingIndicator.innerText = `${data.username} يكتب الآن...`;
});

socket.on('hide_typing', () => {
    typingIndicator.innerText = '';
});

// 4. النافذة المنبثقة والسحب
dragElement(document.getElementById("private-chat-modal"));

function dragElement(elmnt) {
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

function sendPrivateMessage() {
    const msg = privateInput.value.trim();
    if (msg && currentPrivateTargetId) {
        socket.emit('send_private_msg', { targetSocketId: currentPrivateTargetId, message: msg });
        appendPrivateMessage('أنت', msg, null, true);
        privateInput.value = '';
    }
}

privateInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendPrivateMessage();
});

function sendPrivateImage(input) {
    const file = input.files[0];
    if (file && currentPrivateTargetId) {
        const reader = new FileReader();
        reader.onload = function(e) {
            socket.emit('send_private_msg', { targetSocketId: currentPrivateTargetId, message: '', image: e.target.result });
            appendPrivateMessage('أنت', '', e.target.result, true);
            input.value = '';
        };
        reader.readAsDataURL(file);
    }
}

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
    if (unreadCount > 0) {
        badge.innerText = unreadCount;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}
