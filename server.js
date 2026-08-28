const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const GOOGLE_CLIENT_ID = '593400807452-hasied40uonfha4fh157c7vtb0tibkk4.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// الاتصال بقاعدة بيانات MongoDB Atlas السحابية
mongoose.connect('mongodb+srv://socialmediaarab_db_user:i0FCXmqnPJIuK4th@cluster0.ookuhnv.mongodb.net/arabic-chat?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
.catch(err => console.log('خطأ في الاتصال بقاعدة البيانات:', err));

// نموذج بيانات المستخدم مع العمر والجنس والحسابات
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
    password: { type: String },
    googleId: { type: String },
    age: { type: Number },
    gender: { type: String },
    isGuest: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

app.use(express.json({ limit: '10mb' })); // لدعم رفع الصور الكبيرة عبر Base64
app.use(express.static(path.join(__dirname, 'public')));

// مسار دخول الزائر
app.post('/api/guest-login', async (req, res) => {
    try {
        const { username, age, gender } = req.body;
        let existing = await User.findOne({ username });
        if (existing) {
            return res.status(400).json({ success: false, message: 'هذا الاسم مستخدم، اختر اسمًا آخر' });
        }
        const guestUser = new User({ username, age, gender, isGuest: true });
        await guestUser.save();
        res.json({ success: true, username });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// مسار تسجيل الدخول العادي
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        let user = await User.findOne({ $or: [{ email }, { username }] });
        
        if (!user) {
            const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
            user = new User({ username: username || email.split('@')[0], email, password: hashedPassword });
            await user.save();
        } else if (user.password && password) {
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'كلمة المرور غير صحيحة' });
            }
        }
        res.json({ success: true, username: user.username });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// مسار المصادقة عبر جوجل مع الحفظ والتحديث
app.post('/api/google-login', async (req, res) => {
    try {
        const { token, username, age, gender } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, sub: googleId } = payload;

        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ 
                username: username || payload.name, 
                email, 
                googleId, 
                age, 
                gender 
            });
            await user.save();
        } else {
            user.username = username || user.username;
            user.age = age || user.age;
            user.gender = gender || user.gender;
            await user.save();
        }

        res.json({ success: true, username: user.username });
    } catch (err) {
        console.error('Google Auth Error:', err);
        res.status(400).json({ success: false, message: 'فشل المصادقة عبر جوجل' });
    }
});

// إدارة الشات والميزات الكاملة عبر Socket.io
io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        socket.username = data.username;
        socket.join(data.room || 'general');
        io.to(data.room || 'general').emit('chat_message', { system: true, message: `انضم ${data.username} إلى الغرفة` });
        updateActiveUsers(io, data.room || 'general');
    });

    socket.on('send_message', (data) => {
        if (socket.username) {
            io.to(data.room || 'general').emit('chat_message', { 
                username: socket.username, 
                message: data.message,
                image: data.image 
            });
        }
    });

    socket.on('send_private_msg', (data) => {
        socket.to(data.targetSocketId).emit('receive_private_msg', {
            senderId: socket.id,
            senderName: socket.username,
            message: data.message,
            image: data.image
        });
    });

    socket.on('typing', (data) => {
        socket.to(data.room || 'general').emit('display_typing', { username: socket.username });
    });

    socket.on('stop_typing', (data) => {
        socket.to(data.room || 'general').emit('hide_typing');
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            io.emit('chat_message', { system: true, message: `غادر ${socket.username} الغرفة` });
            updateActiveUsers(io, 'general');
        }
    });
});

function updateActiveUsers(io, room) {
    const roomClients = io.sockets.adapter.rooms.get(room);
    const users = [];
    if (roomClients) {
        roomClients.forEach((socketId) => {
            const s = io.sockets.sockets.get(socketId);
            if (s && s.username) {
                users.push({ id: s.id, username: s.username });
            }
        });
    }
    io.to(room).emit('update_users', users);
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على المنفذ: ${PORT}`);
});
