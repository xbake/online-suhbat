const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const prisma = new PrismaClient();
const app = express();

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const SERVER_URL = process.env.SERVER_URL || "http://localhost:4000";

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Faqat rasm fayllariga ruxsat berilgan"));
  },
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server ishlayapti" });
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Token yo'q" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token yaroqsiz" });
  }
}

app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username va parol kerak" });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: "Parol kamida 4 ta belgidan iborat bo'lishi kerak" });
    }
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return res.status(400).json({ error: "Bu username band" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, password: hashedPassword },
    });
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server xatosi" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(400).json({ error: "Username yoki parol noto'g'ri" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Username yoki parol noto'g'ri" });
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server xatosi" });
  }
});

app.post("/api/upload", authMiddleware, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fayl yuklanmadi" });
  const imageUrl = `${SERVER_URL}/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

app.get("/api/messages/:otherUsername", authMiddleware, async (req, res) => {
  try {
    const otherUser = await prisma.user.findUnique({
      where: { username: req.params.otherUsername },
    });
    if (!otherUser) return res.json([]);

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { fromId: req.userId, toId: otherUser.id },
          { fromId: otherUser.id, toId: req.userId },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: { from: true, to: true, reactions: { include: { user: true } } },
    });

    await prisma.message.updateMany({
      where: { fromId: otherUser.id, toId: req.userId, read: false },
      data: { read: true },
    });

    const targetSocketId = onlineUsers[otherUser.username];
    if (targetSocketId) {
      io.to(targetSocketId).emit("read_receipt", { by: req.username });
    }

    const formatted = messages.map((m) => ({
      id: m.id,
      from: m.from.username,
      to: m.to.username,
      text: m.text,
      imageUrl: m.imageUrl,
      read: m.fromId === req.userId ? m.read : true,
      time: new Date(m.createdAt).toLocaleTimeString("uz-UZ", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      reactions: m.reactions.map((r) => ({ emoji: r.emoji, username: r.user.username })),
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server xatosi" });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] },
});

const onlineUsers = {};

function broadcastUserList() {
  io.emit("user_list", Object.keys(onlineUsers));
}

io.on("connection", (socket) => {
  console.log("Yangi ulanish:", socket.id);

  socket.on("join", (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.data.username = decoded.username;
      socket.data.userId = decoded.userId;
      onlineUsers[decoded.username] = socket.id;
      broadcastUserList();
    } catch (err) {
      socket.emit("auth_error", "Token yaroqsiz, qayta kiring");
    }
  });

  socket.on("private_message", async ({ to, text, imageUrl }) => {
    const from = socket.data.username;
    const fromId = socket.data.userId;
    if (!from) return;

    try {
      const toUser = await prisma.user.findUnique({ where: { username: to } });
      if (!toUser) return;

      const saved = await prisma.message.create({
        data: { text: text || "", imageUrl: imageUrl || null, fromId, toId: toUser.id },
      });

      const time = new Date(saved.createdAt).toLocaleTimeString("uz-UZ", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const payload = {
        id: saved.id,
        from,
        to,
        text: saved.text,
        imageUrl: saved.imageUrl,
        read: false,
        time,
        reactions: [],
      };

      const targetSocketId = onlineUsers[to];
      if (targetSocketId) {
        io.to(targetSocketId).emit("private_message", payload);
      }
      socket.emit("private_message", payload);
    } catch (err) {
      console.error("Xabarni saqlashda xatolik:", err);
    }
  });

  socket.on("toggle_reaction", async ({ messageId, emoji, otherUsername }) => {
    const userId = socket.data.userId;
    if (!userId) return;

    try {
      const existing = await prisma.reaction.findUnique({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
      });

      if (existing) {
        await prisma.reaction.delete({ where: { id: existing.id } });
      } else {
        await prisma.reaction.create({ data: { messageId, userId, emoji } });
      }

      const reactions = await prisma.reaction.findMany({
        where: { messageId },
        include: { user: true },
      });
      const formattedReactions = reactions.map((r) => ({ emoji: r.emoji, username: r.user.username }));

      const payload = { messageId, reactions: formattedReactions };

      const targetSocketId = onlineUsers[otherUsername];
      if (targetSocketId) io.to(targetSocketId).emit("reaction_update", payload);
      socket.emit("reaction_update", payload);
    } catch (err) {
      console.error("Reaksiya xatosi:", err);
    }
  });

  socket.on("typing", ({ to }) => {
    const from = socket.data.username;
    if (!from) return;
    const targetSocketId = onlineUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit("user_typing", { from });
    }
  });

  socket.on("stop_typing", ({ to }) => {
    const from = socket.data.username;
    if (!from) return;
    const targetSocketId = onlineUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit("user_stop_typing", { from });
    }
  });

  socket.on("disconnect", () => {
    if (socket.data.username) {
      delete onlineUsers[socket.data.username];
      broadcastUserList();
    }
    console.log("Uzildi:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server ${PORT} portda ishga tushdi`);
});