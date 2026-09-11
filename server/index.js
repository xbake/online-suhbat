// server/index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Oddiy tekshiruv endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server ishlayapti" });
});

const server = http.createServer(app);

// Socket.io ni HTTP serverga ulaymiz
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Next.js manzili
    methods: ["GET", "POST"],
  },
});

// Har bir yangi ulanishni kuzatib boramiz
io.on("connection", (socket) => {
  console.log("Yangi foydalanuvchi ulandi:", socket.id);

  // Mijozdan "salom" xabari kelsa
  socket.on("salom", (data) => {
    console.log("Xabar keldi:", data);
    socket.emit("javob", { text: "Salom, server tomondan!" });
  });

  socket.on("disconnect", () => {
    console.log("Foydalanuvchi uzildi:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server ${PORT} portda ishga tushdi`);
});