import express from "express";
import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import cors from "cors";
import bodyParser from "body-parser";
import Message from "./models/Message.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

mongoose.connect("mongodb://localhost:27017/chatapp", { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=>console.log("MongoDB connected"))
  .catch(e=>console.error("MongoDB error", e));

/* In-memory rooms and users */
const rooms = [{ id: "general", name: "General" }];
const users = new Map(); // socketId -> username

app.get("/api/rooms", (req, res) => res.json(rooms));
app.post("/api/rooms", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ msg: "Name required" });
  const id = String(Date.now());
  const room = { id, name };
  rooms.push(room);
  res.json(room);
});

/* List known users (non-persistent) */
app.get("/api/users", (req, res) => {
  const arr = Array.from(users.values());
  res.json([...new Set(arr)]);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/* room -> Set of {socketId, user} */
const roomUsers = new Map();

io.on("connection", (socket) => {
  socket.currentRoom = null;
  socket.username = null;

  // register username (client should emit 'register' after picking a name)
  socket.on("register", (username) => {
    socket.username = username;
    users.set(socket.id, username);
    // broadcast updated global users
    io.emit("globalUsers", Array.from(new Set(Array.from(users.values()))));
  });

  socket.on("joinRoom", async ({ roomId, username }) => {
    if (!roomId || !username) return;
    // leave previous
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
      const oldSet = roomUsers.get(socket.currentRoom);
      if (oldSet) {
        for (let item of oldSet) if (item.socketId === socket.id) oldSet.delete(item);
        io.to(socket.currentRoom).emit("roomUsers", Array.from(oldSet).map(s=>s.user));
      }
    }

    socket.join(roomId);
    socket.currentRoom = roomId;
    socket.username = username;
    users.set(socket.id, username);

    if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Set());
    const set = roomUsers.get(roomId);
    set.add({ socketId: socket.id, user: username });
    io.to(roomId).emit("roomUsers", Array.from(set).map(s=>s.user));

    // send last messages for this room (non-private)
    const history = await Message.find({ isPrivate: false, room: roomId }).sort({ timestamp: 1 }).limit(500);
    socket.emit("history", history);
    io.emit("globalUsers", Array.from(new Set(Array.from(users.values()))));
  });

  // join a private conversation between socket.username and otherUser
  socket.on("joinPrivate", async ({ other }) => {
    if (!socket.username || !other) return;
    // conversation id: sorted pair
    const a = socket.username;
    const b = other;
    const convoId = [a,b].sort().join("::");
    // join a room named with convoId for socket.io broadcasting
    socket.join(convoId);
    // send history of private messages between a and b
    const history = await Message.find({ isPrivate: true, participants: { $all: [a,b] } }).sort({ timestamp: 1 }).limit(1000);
    socket.emit("privateHistory", { with: other, messages: history });
  });

  socket.on("message", async (data) => {
    const { room, user, text, isPrivate, to } = data;
    if (isPrivate) {
      // private message between user and 'to'
      if (!user || !to) return;
      const participants = [user, to];
      const convoId = participants.slice().sort().join("::");
      const msg = await Message.create({ isPrivate: true, participants, text, user });
      io.to(convoId).emit("privateMessage", msg);
    } else {
      if (!room || !user || !text) return;
      const msg = await Message.create({ room, user, text, isPrivate: false });
      io.to(room).emit("message", msg);
    }
  });

  socket.on("typing", ({ room, user, isPrivate, to }) => {
    if (isPrivate) {
      const convoId = [user, to].sort().join("::");
      socket.to(convoId).emit("typingPrivate", { user });
    } else {
      socket.to(room).emit("typing", { user });
    }
  });

  socket.on("stopTyping", ({ room, user, isPrivate, to }) => {
    if (isPrivate) {
      const convoId = [user, to].sort().join("::");
      socket.to(convoId).emit("stopTypingPrivate", { user });
    } else {
      socket.to(room).emit("stopTyping", { user });
    }
  });

  socket.on("disconnect", () => {
    users.delete(socket.id);
    // remove from any room sets
    for (let [roomId, set] of roomUsers.entries()) {
      for (let item of set) if (item.socketId === socket.id) set.delete(item);
      io.to(roomId).emit("roomUsers", Array.from(set).map(s=>s.user));
    }
    io.emit("globalUsers", Array.from(new Set(Array.from(users.values()))));
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
