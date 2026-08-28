const socket = io();

let currentUser = prompt('أدخل اسمك للدخول إلى الدردشة:');
if (!currentUser || currentUser.trim() === '') {
    currentUser = 'زائر_' + Math.floor(Math.random() * 1000);
}

let currentRoom = 'general';
let currentPrivateTargetId = null;
let unreadCount = 0;

// قائمة الأشخاص النشطين في الخاص { socketId: username }
let activePmUsers = {};

// تخزين سجل الرسائل الخاص بكل مستخدم { socketId: [ {sender, msg, image, isMe} ] }
let pmChatHistories = {};

const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
const emojis = ['😀', '😂', '😍', '❤️', '👍', '🔥', '🎉', '😊', '😭', '😎', '🙏', '✨', '🤣'];

socket.on('connect', () => {
    socket.emit('join_room', { username: currentUser, room: currentRoom });
});

window.addEventListener('DOMContentLoaded', () => {
    setupEmojiPicker('public-emoji-list', 'public-input');
    setupEmojiPicker('private-emoji-list', 'private-input');
    makeModalDraggable(document.getElementById("private-chat-modal"));
});

function setupEmojiPicker(pickerId, inputId) {
    const picker = document.getElementById(pickerId);
    if (!picker) return;
    picker.innerHTML = '';
    emojis.forEach(e => {
        const span = document.createElement('span');
        span.innerText = e;
        span.onclick = (event) => {
            event.stopPropagation();
            const input = document.getElementById(inputId);
            if (input) {
                input.value += e;
                input.focus();
            }
            picker.style.display = 'none';
        };
        picker.appendChild(span);
    });
}

function toggleEmojiPicker(pickerId) {
    const picker = document.getElementById(pickerId);
    if (picker) {
        picker.style.display = (picker.style.display === 'flex') ? 'none' : 'flex';
    }
}

// --- الشات العام ---
function sendPublicMessage() {
    const publicInput = document.getElementById('public-input');
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

document.getElementById('public-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendPublicMessage();
});

let typingTimeout;
document.getElementById('public-input').addEventListener('input', () => {
    socket.emit('typing', { room: currentRoom });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing', { room: currentRoom });
    }, 1000);
});

socket.on('chat_message', (data) => {
    const publicMessages = document.getElementById('public-messages');
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

// --- قائمة المتصلين ---
socket.on('update_users', (users) => {
    const usersList = document.getElementById('users-list');
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

socket.on('display_typing', (data) => {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.innerText = `${data.username} يكتب الآن...`;
});

socket.on('hide_typing', () => {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.innerText = '';
});

// --- إدارة قائمة صندوق الخاص (Inbox) ---
function togglePmInboxModal() {
    const modal = document.getElementById('pm-inbox-modal');
    if (modal.style.display === 'block') {
        modal.style.display = 'none';
    } else {
        renderPmInboxList();
        modal.style.display = 'block';
    }
}

function renderPmInboxList() {
    const container = document.getElementById('pm-inbox-list');
    container.innerHTML = '';

    const keys = Object.keys(activePmUsers);
    if (keys.length === 0) {
        container.innerHTML = '<div style="padding:15px; text-align:center; color:#888;">لا توجد رسائل خاصة حالياً</div>';
        return;
    }

    keys.forEach(id => {
        const username = activePmUsers[id];
        const item = document.createElement('div');
        item.className = 'pm-inbox-item';
        
        item.innerHTML = `
            <span class="pm-inbox-close" onclick="removePmConversation(event, '${id}')">✖</span>
            <div class="pm-inbox-user" onclick="selectUserFromInbox('${id}', '${username}')">
                <span>👤 ${username}</span>
            </div>
        `;
        container.appendChild(item);
    });
}

function selectUserFromInbox(targetId, username) {
    document.getElementById('pm-inbox-modal').style.display = 'none';
    openPrivateChat(targetId, username);
}

function removePmConversation(event, targetId) {
    event.stopPropagation();
    delete activePmUsers[targetId];
    delete pmChatHistories[targetId];
    renderPmInboxList();
    if (currentPrivateTargetId === targetId) {
        closePrivateModal();
    }
}

function clearAllPmConversations() {
    activePmUsers = {};
    pmChatHistories = {};
    renderPmInboxList();
    unreadCount = 0;
    updateBadge();
    closePrivateModal();
}

// --- الشات الخاص المستقل ---
function openPrivateChat(targetSocketId, targetUsername) {
    currentPrivateTargetId = targetSocketId;
    activePmUsers[targetSocketId] = targetUsername;

    // إنشاء سجل فارغ للمستخدم إذا لم يكن موجوداً
    if (!pmChatHistories[targetSocketId]) {
        pmChatHistories[targetSocketId] = [];
    }

    document.getElementById('private-target-name').innerText = `محادثة مع: ${targetUsername}`;
    
    // إعادة بناء شاشة المحادثة واستعراض السجل الخاص بهذا المستخدم فقط
    loadPrivateChatHistory(targetSocketId);

    const modal = document.getElementById('private-chat-modal');
    modal.style.display = 'block';
    
    unreadCount = 0;
    updateBadge();

    setTimeout(() => {
        const privateInp = document.getElementById('private-input');
        if (privateInp) {
            privateInp.focus();
        }
    }, 100);
}

function loadPrivateChatHistory(targetSocketId) {
    const msgContainer = document.getElementById('private-messages');
    msgContainer.innerHTML = ''; // مسح المحادثة السابقة من الشاشة

    const history = pmChatHistories[targetSocketId] || [];
    history.forEach(item => {
        renderSinglePrivateMsg(item.sender, item.msg, item.image, item.isMe);
    });
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

function closePrivateModal() {
    document.getElementById('private-chat-modal').style.display = 'none';
    currentPrivateTargetId = null;
}

function sendPrivateMessage() {
    const privateInp = document.getElementById('private-input');
    if (!privateInp) return;

    const msg = privateInp.value.trim();
    if (msg && currentPrivateTargetId) {
        socket.emit('send_private_msg', { 
            targetSocketId: currentPrivateTargetId, 
            message: msg 
        });
        
        // حفظ الرسالة في سجل المستخدم المستهدف
        saveAndAppendPrivateMsg(currentPrivateTargetId, 'أنت', msg, null, true);
        privateInp.value = '';
        privateInp.focus();
    }
}

document.getElementById('private-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendPrivateMessage();
    }
});

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
            saveAndAppendPrivateMsg(currentPrivateTargetId, 'أنت', '', e.target.result, true);
            input.value = '';
        };
        reader.readAsDataURL(file);
    }
}

socket.on('receive_private_msg', (data) => {
    notificationSound.play().catch(() => {});
    
    activePmUsers[data.senderId] = data.senderName;
    
    if (!pmChatHistories[data.senderId]) {
        pmChatHistories[data.senderId] = [];
    }

    // حفظ الرسالة الواردة في سجّل المرسل الخاص فقط
    pmChatHistories[data.senderId].push({
        sender: data.senderName,
        msg: data.message,
        image: data.image,
        isMe: false
    });

    const modal = document.getElementById('private-chat-modal');

    // إذا كانت نافذة هذا الشخص مفتوحة حالياً، نقوم بطلب عرض الرسالة
    if (modal.style.display === 'block' && currentPrivateTargetId === data.senderId) {
        renderSinglePrivateMsg(data.senderName, data.message, data.image, false);
    } else {
        unreadCount++;
        updateBadge();
    }
});

function saveAndAppendPrivateMsg(targetId, sender, msg, image, isMe) {
    if (!pmChatHistories[targetId]) {
        pmChatHistories[targetId] = [];
    }
    pmChatHistories[targetId].push({ sender, msg, image, isMe });
    renderSinglePrivateMsg(sender, msg, image, isMe);
}

function renderSinglePrivateMsg(sender, msg, image, isMe) {
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

function makeModalDraggable(elmnt) {
    if (!elmnt) return;
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = document.getElementById("private-modal-header");

    if (header) {
        header.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e = e || window.event;
        if (e.target.tagName === 'BUTTON') return;
        
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
