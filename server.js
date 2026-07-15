const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((url) => url.trim())
  : ["http://localhost:3000", "http://localhost:5173"];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  }),
);

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.status(200).send("Video Call Signaling Server Running");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
  });
});

io.on("connection", (socket) => {
  console.log("User Connected:", socket.id);

  socket.on("join-room", (roomId) => {
    if (!roomId) {
      socket.emit("server-error", {
        message: "Room ID is required",
      });
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    console.log(`${socket.id} joined room: ${roomId}`);

    socket.to(roomId).emit("user-joined", {
      userId: socket.id,
    });
  });

  socket.on("offer", ({ roomId, offer }) => {
    if (!roomId || !offer) return;

    socket.to(roomId).emit("offer", {
      offer,
      sender: socket.id,
    });
  });

  socket.on("answer", ({ roomId, answer }) => {
    if (!roomId || !answer) return;

    socket.to(roomId).emit("answer", {
      answer,
      sender: socket.id,
    });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    if (!roomId || !candidate) return;

    socket.to(roomId).emit("ice-candidate", {
      candidate,
      sender: socket.id,
    });
  });

  socket.on("leave-room", (roomId) => {
    if (!roomId) return;

    socket.to(roomId).emit("user-left", {
      userId: socket.id,
    });

    socket.leave(roomId);
    socket.data.roomId = null;

    console.log(`${socket.id} left room: ${roomId}`);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;

    if (roomId) {
      socket.to(roomId).emit("user-left", {
        userId: socket.id,
      });
    }

    console.log("User Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
