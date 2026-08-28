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

// تم تحديث الـ Client ID بالمعرّف الخاص بك
const GOOGLE_CLIENT_ID = '593400807452-hasied40uonfha4fh157c7vtb0tibkk4.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// الاتصال بقاعدة بيانات MongoDB Atlas السحابية
mongoose.connect('mongodb+srv://socialmediaarab_db_user:i0FCXmqnPJIuK4th@cluster0.ookuhnv.mongodb.net/arabic-chat?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
.catch(err => console.log('خطأ في الاتصال بقاعدة البيانات:', err));

// تعريف نموذج المستخدم (User Schema)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
    password: { type: String }, // قد يكون فارغاً في حال تسجيل الدخول عبر جوجل
    googleId: { type: String }
});

const User = mongoose.model('User', userSchema);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// مسار تسجيل الدخول العادي بالبريد وكلمة المرور
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        // دعم البحث بالبريد أو اسم المستخدم
        let user = await User.findOne({ $or: [{ email }, { username }] });
        
        if (!user) {
            // إذا لم يكن المستخدم موجوداً، نقوم بإنشائه تلقائياً (تسجيل جديد)
            const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
            user = new User({ username: username || email.split('@')[0], email, password: hashedPassword });
            await user.save();
        } else if (user.password && password) {
            // إذا كان المستخدم موجوداً وله كلمة مرور، نتحقق منها
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

// مسار إنشاء حساب جديد (Registration Route)
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        let existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'المستخدم أو البريد الإلكتروني موجود مسبقاً' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword });
        await newUser.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'حدث خطأ في الخادم' });
    }
});

// مسار المصادقة عبر جوجل (Google Auth)
app.post('/api/google-login', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;

        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ username: name, email, googleId });
            await user.save();
        }

        res.json({ success: true, username: user.username });
    } catch (err) {
        console.error('Google Auth Error:', err);
        res.status(400).json({ success: false, message: 'فشل المصادقة عبر جوجل' });
    }
});

// إدارة الشات عبر Socket.io
io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

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
        console.log('مستخدم غادر:', socket.id);
        io.emit('chat_message', { system: true, message: `غادر المستخدم الغرفة` });
        updateActiveUsers(io, 'general');
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
