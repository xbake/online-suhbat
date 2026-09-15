"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";

let socket: Socket;

type Reaction = { emoji: string; username: string };

type PrivateMessage = {
  id?: number;
  from: string;
  to: string;
  text: string;
  imageUrl?: string | null;
  read?: boolean;
  time: string;
  reactions?: Reaction[];
};

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function getColor(name: string) {
  const colors = [
    "bg-pink-500",
    "bg-purple-500",
    "bg-indigo-500",
    "bg-teal-500",
    "bg-orange-500",
    "bg-rose-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return colors[hash % colors.length];
}

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  } catch (err) {
    console.error("Tovush xatosi:", err);
  }
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const PICKER_EMOJIS = [
  "😀", "😂", "😍", "😎", "😢", "😡", "👍", "👎", "❤️", "🔥",
  "🎉", "🙏", "😮", "😴", "🤔", "😭", "👏", "💯", "✅", "❌",
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function Home() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  const [token, setToken] = useState<string | null>(null);
  const [myUsername, setMyUsername] = useState<string | null>(null);

  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [input, setInput] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<number | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const selectedUserRef = useRef<string | null>(null);
  const myUsernameRef = useRef<string | null>(null);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    myUsernameRef.current = myUsername;
  }, [myUsername]);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    const savedUsername = localStorage.getItem("username");
    if (savedToken && savedUsername) {
      setToken(savedToken);
      setMyUsername(savedUsername);
    }
  }, []);

  useEffect(() => {
    if (token && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    socket = io(API_URL);
    socket.on("connect", () => {
      socket.emit("join", token);
    });
    socket.on("auth_error", () => {
      handleLogout();
    });
    socket.on("user_list", (users: string[]) => setOnlineUsers(users));
    socket.on("private_message", (data: PrivateMessage) => {
      setMessages((prev) => [...prev, data]);

      const isIncoming = data.from !== myUsernameRef.current;
      if (isIncoming) {
        playNotificationSound();

        if (data.from !== selectedUserRef.current) {
          setUnreadCounts((prev) => ({
            ...prev,
            [data.from]: (prev[data.from] || 0) + 1,
          }));
        }

        if (
          "Notification" in window &&
          Notification.permission === "granted" &&
          (document.hidden || data.from !== selectedUserRef.current)
        ) {
          new Notification(`${data.from}dan yangi xabar`, {
            body: data.imageUrl ? "📷 Rasm yubordi" : data.text,
            icon: "/favicon.ico",
          });
        }
      }
    });
    socket.on("read_receipt", ({ by }: { by: string }) => {
      setMessages((prev) =>
        prev.map((m) => (m.to === by ? { ...m, read: true } : m))
      );
    });
    socket.on("reaction_update", ({ messageId, reactions }: { messageId: number; reactions: Reaction[] }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
      );
    });
    socket.on("user_typing", ({ from }: { from: string }) => {
      setTypingUsers((prev) => new Set(prev).add(from));
    });
    socket.on("user_stop_typing", ({ from }: { from: string }) => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        next.delete(from);
        return next;
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedUser]);

  const handleSelectUser = async (u: string) => {
    setSelectedUser(u);
    setUnreadCounts((prev) => ({ ...prev, [u]: 0 }));
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/messages/${u}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const history: PrivateMessage[] = await res.json();
      setMessages((prev) => {
        const others = prev.filter(
          (m) =>
            !(
              (m.from === myUsername && m.to === u) ||
              (m.from === u && m.to === myUsername)
            )
        );
        return [...others, ...history];
      });
    } catch (err) {
      console.error("Tarixni yuklashda xatolik:", err);
    }
    setHistoryLoading(false);
  };

  const handleAuth = async () => {
    setAuthError("");
    if (!username.trim() || !password.trim()) {
      setAuthError("Username va parolni kiriting");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Xatolik yuz berdi");
        setLoading(false);
        return;
      }
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);
      setToken(data.token);
      setMyUsername(data.username);
    } catch (err) {
      setAuthError("Serverga ulanib bo'lmadi");
    }
    setLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setToken(null);
    setMyUsername(null);
    setSelectedUser(null);
    setMessages([]);
    setUnreadCounts({});
    if (socket) socket.disconnect();
  };

  const sendMessage = () => {
    if (input.trim() && selectedUser) {
      socket.emit("private_message", { to: selectedUser, text: input });
      setInput("");
      setShowEmojiPicker(false);
      if (isTypingRef.current) {
        socket.emit("stop_typing", { to: selectedUser });
        isTypingRef.current = false;
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (!selectedUser) return;

    if (!isTypingRef.current) {
      socket.emit("typing", { to: selectedUser });
      isTypingRef.current = true;
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("stop_typing", { to: selectedUser });
      isTypingRef.current = false;
    }, 1500);
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedUser) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.imageUrl) {
        socket.emit("private_message", { to: selectedUser, text: "", imageUrl: data.imageUrl });
      }
    } catch (err) {
      console.error("Rasm yuklashda xatolik:", err);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleToggleReaction = (messageId: number | undefined, emoji: string) => {
    if (!messageId || !selectedUser) return;
    socket.emit("toggle_reaction", { messageId, emoji, otherUsername: selectedUser });
    setReactionPickerFor(null);
  };

  if (!token || !myUsername) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 gap-5 sm:gap-6 px-4 py-8">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-xl sm:text-2xl font-bold shadow-lg shadow-blue-600/30">
          💬
        </div>
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">Onlayn Suhbat</h1>
          <p className="text-slate-400 text-sm">
            {mode === "login" ? "Hisobingizga kiring" : "Yangi hisob yarating"}
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <input
            className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-base"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-base"
            placeholder="Parol"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAuth()}
          />
          {authError && <p className="text-red-400 text-sm text-center">{authError}</p>}
          <button
            onClick={handleAuth}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors text-white font-medium rounded-xl py-3 shadow-lg shadow-blue-600/20 disabled:opacity-50"
          >
            {loading ? "Kutilmoqda..." : mode === "login" ? "Kirish" : "Ro'yxatdan o'tish"}
          </button>
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setAuthError("");
            }}
            className="text-slate-400 text-sm hover:text-white transition-colors py-1"
          >
            {mode === "login"
              ? "Hisobingiz yo'qmi? Ro'yxatdan o'ting"
              : "Hisobingiz bormi? Kiring"}
          </button>
        </div>
      </div>
    );
  }

  const conversation = messages.filter(
    (m) =>
      (m.from === myUsername && m.to === selectedUser) ||
      (m.from === selectedUser && m.to === myUsername)
  );

  const selectedUserTyping = selectedUser ? typingUsers.has(selectedUser) : false;

  return (
    <div className="flex h-[100dvh] bg-slate-900 md:max-w-4xl md:mx-auto md:shadow-2xl overflow-hidden">
      <div
        className={`
          w-full md:w-72 md:shrink-0 border-r border-slate-800 flex-col
          ${selectedUser ? "hidden md:flex" : "flex"}
        `}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 shrink-0 rounded-full ${getColor(myUsername)} flex items-center justify-center text-white text-sm font-semibold`}>
              {getInitials(myUsername)}
            </div>
            <div className="min-w-0">
              <p className="text-white font-medium text-sm truncate">{myUsername}</p>
              <p className="text-green-400 text-xs">● Online</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-slate-500 hover:text-red-400 text-xs transition-colors shrink-0 pl-2"
          >
            Chiqish
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {onlineUsers.filter((u) => u !== myUsername).length === 0 && (
            <p className="text-slate-500 text-sm text-center mt-6 px-4">
              Hozircha boshqa kimsa yo'q.
            </p>
          )}
          {onlineUsers
            .filter((u) => u !== myUsername)
            .map((u) => (
              <div
                key={u}
                onClick={() => handleSelectUser(u)}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors mb-1 ${
                  selectedUser === u ? "bg-blue-600" : "hover:bg-slate-800"
                }`}
              >
                <div className={`w-9 h-9 shrink-0 rounded-full ${getColor(u)} flex items-center justify-center text-white text-sm font-semibold`}>
                  {getInitials(u)}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-white text-sm font-medium truncate">{u}</span>
                  {typingUsers.has(u) && (
                    <span className="text-green-400 text-xs italic">yozmoqda...</span>
                  )}
                </div>
                {unreadCounts[u] > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 shrink-0">
                    {unreadCounts[u]}
                  </span>
                )}
              </div>
            ))}
        </div>
      </div>

      <div
        className={`
          flex-1 min-w-0 flex-col
          ${selectedUser ? "flex" : "hidden md:flex"}
        `}
      >
        {!selectedUser ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2 px-4 text-center">
            <div className="text-4xl">👋</div>
            <p>Suhbatlashish uchun chapdan foydalanuvchi tanlang</p>
          </div>
        ) : (
          <>
            <div className="p-3 sm:p-4 border-b border-slate-800 flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setSelectedUser(null)}
                className="md:hidden text-slate-400 hover:text-white transition-colors text-xl px-1 shrink-0"
                aria-label="Orqaga"
              >
                ←
              </button>
              <div className={`w-9 h-9 shrink-0 rounded-full ${getColor(selectedUser)} flex items-center justify-center text-white text-sm font-semibold`}>
                {getInitials(selectedUser)}
              </div>
              <div className="min-w-0">
                <p className="text-white font-medium truncate">{selectedUser}</p>
                {selectedUserTyping && (
                  <p className="text-green-400 text-xs italic">yozmoqda...</p>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
              {historyLoading && (
                <p className="text-slate-500 text-sm text-center">Yuklanmoqda...</p>
              )}
              {conversation.map((msg, i) => {
                const isMine = msg.from === myUsername;
                const grouped: Record<string, number> = {};
                (msg.reactions || []).forEach((r) => {
                  grouped[r.emoji] = (grouped[r.emoji] || 0) + 1;
                });

                return (
                  <div key={msg.id ?? i} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] sm:max-w-xs ${isMine ? "items-end" : "items-start"} flex flex-col gap-1 relative group`}>
                      {msg.imageUrl && (
                        <img
                          src={msg.imageUrl}
                          alt="rasm"
                          className="rounded-xl max-w-[160px] sm:max-w-[200px] max-h-[160px] sm:max-h-[200px] object-cover"
                        />
                      )}
                      {msg.text && (
                        <div
                          onDoubleClick={() =>
                            setReactionPickerFor(reactionPickerFor === msg.id ? null : msg.id ?? null)
                          }
                          className={`px-4 py-2 rounded-2xl text-sm cursor-pointer break-words ${
                            isMine
                              ? "bg-blue-600 text-white rounded-br-sm"
                              : "bg-slate-800 text-white rounded-bl-sm"
                          }`}
                        >
                          {msg.text}
                        </div>
                      )}

                      {Object.keys(grouped).length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {Object.entries(grouped).map(([emoji, count]) => (
                            <span
                              key={emoji}
                              onClick={() => handleToggleReaction(msg.id, emoji)}
                              className="bg-slate-700 rounded-full px-2 py-0.5 text-xs cursor-pointer hover:bg-slate-600"
                            >
                              {emoji} {count > 1 ? count : ""}
                            </span>
                          ))}
                        </div>
                      )}

                      {reactionPickerFor === msg.id && (
                        <div className="absolute -top-10 bg-slate-800 rounded-full px-2 py-1 flex gap-1 shadow-lg z-10 border border-slate-700">
                          {QUICK_EMOJIS.map((e) => (
                            <button
                              key={e}
                              onClick={() => handleToggleReaction(msg.id, e)}
                              className="hover:scale-125 transition-transform text-lg"
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      )}

                      {msg.imageUrl && !msg.text && (
                        <button
                          onClick={() =>
                            setReactionPickerFor(reactionPickerFor === msg.id ? null : msg.id ?? null)
                          }
                          className="text-slate-500 text-xs opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity self-start"
                        >
                          😊 reaksiya
                        </button>
                      )}

                      <span className="text-slate-500 text-xs px-1 flex items-center gap-1">
                        {msg.time}
                        {isMine && (
                          <span className={msg.read ? "text-blue-400" : "text-slate-500"}>
                            {msg.read ? "✓✓" : "✓"}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
              {selectedUserTyping && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-2 flex gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {showEmojiPicker && (
              <div className="mx-3 sm:mx-4 mb-2 p-3 bg-slate-800 rounded-xl border border-slate-700 grid grid-cols-6 sm:grid-cols-10 gap-2 max-h-40 overflow-y-auto">
                {PICKER_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setInput((prev) => prev + e)}
                    className="text-xl hover:scale-125 transition-transform"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}

            <div className="p-3 sm:p-4 border-t border-slate-800 flex gap-1.5 sm:gap-2 items-center">
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleImageSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-slate-400 hover:text-white transition-colors text-xl px-1 shrink-0"
                title="Rasm yuborish"
              >
                {uploading ? "⏳" : "📎"}
              </button>
              <button
                onClick={() => setShowEmojiPicker((prev) => !prev)}
                className="text-slate-400 hover:text-white transition-colors text-xl px-1 shrink-0"
                title="Emoji"
              >
                😊
              </button>
              <input
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl px-3 sm:px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-base"
                placeholder="Xabar yozing..."
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              />
              <button
                onClick={sendMessage}
                className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors text-white rounded-xl px-3 sm:px-5 py-2 font-medium shrink-0"
              >
                Yuborish
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}