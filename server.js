// const express = require("express");
// const http = require("http");
// const { Server } = require("socket.io");
// const cors = require("cors");

// const app = express();

// const allowedOrigins = process.env.CLIENT_URL
//   ? process.env.CLIENT_URL.split(",").map((url) => url.trim())
//   : ["http://localhost:3000", "http://localhost:5173"];

// app.use(
//   cors({
//     origin: allowedOrigins,
//     methods: ["GET", "POST"],
//   }),
// );

// app.use(express.json());

// const server = http.createServer(app);

// const io = new Server(server, {
//   cors: {
//     origin: allowedOrigins,
//     methods: ["GET", "POST"],
//   },
// });

// app.get("/", (req, res) => {
//   res.status(200).send("Video Call Signaling Server Running");
// });

// app.get("/health", (req, res) => {
//   res.status(200).json({
//     success: true,
//     message: "Server is healthy",
//   });
// });

// io.on("connection", (socket) => {
//   console.log("User Connected:", socket.id);

//   socket.on("join-room", (roomId) => {
//     if (!roomId) {
//       socket.emit("server-error", {
//         message: "Room ID is required",
//       });
//       return;
//     }

//     socket.join(roomId);
//     socket.data.roomId = roomId;

//     console.log(`${socket.id} joined room: ${roomId}`);

//     socket.to(roomId).emit("user-joined", {
//       userId: socket.id,
//     });
//   });

//   socket.on("offer", ({ roomId, offer }) => {
//     if (!roomId || !offer) return;

//     socket.to(roomId).emit("offer", {
//       offer,
//       sender: socket.id,
//     });
//   });

//   socket.on("answer", ({ roomId, answer }) => {
//     if (!roomId || !answer) return;

//     socket.to(roomId).emit("answer", {
//       answer,
//       sender: socket.id,
//     });
//   });

//   socket.on("ice-candidate", ({ roomId, candidate }) => {
//     if (!roomId || !candidate) return;

//     socket.to(roomId).emit("ice-candidate", {
//       candidate,
//       sender: socket.id,
//     });
//   });

//   socket.on("leave-room", (roomId) => {
//     if (!roomId) return;

//     socket.to(roomId).emit("user-left", {
//       userId: socket.id,
//     });

//     socket.leave(roomId);
//     socket.data.roomId = null;

//     console.log(`${socket.id} left room: ${roomId}`);
//   });

//   socket.on("disconnect", () => {
//     const roomId = socket.data.roomId;

//     if (roomId) {
//       socket.to(roomId).emit("user-left", {
//         userId: socket.id,
//       });
//     }

//     console.log("User Disconnected:", socket.id);
//   });
// });

// const PORT = process.env.PORT || 5000;

// server.listen(PORT, "0.0.0.0", () => {
//   console.log(`Server running on port ${PORT}`);
// });







const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

/*
|--------------------------------------------------------------------------
| Allowed frontend URLs
|--------------------------------------------------------------------------
|
| Railway/Render/Vercel environment variable example:
|
| CLIENT_URL=https://your-frontend.vercel.app,http://localhost:3000
|
*/
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean)
  : ["http://localhost:3000", "http://localhost:5173"];

/*
|--------------------------------------------------------------------------
| Express middleware
|--------------------------------------------------------------------------
*/

app.use(
  cors({
    origin: (origin, callback) => {
      /*
       * Postman, mobile apps and server-to-server requests
       * may not contain an Origin header.
       */
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("Blocked CORS origin:", origin);

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

app.use(express.json());

/*
|--------------------------------------------------------------------------
| HTTP and Socket.IO server
|--------------------------------------------------------------------------
*/

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("Blocked Socket.IO origin:", origin);

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },

  /*
   * WebSocket preferred rahega.
   * Agar WebSocket unavailable hua to polling fallback hoga.
   */
  transports: ["websocket", "polling"],

  /*
   * Temporary internet interruption ke case me socket ko
   * disconnect hone se bachane ke liye.
   */
  pingTimeout: 60000,
  pingInterval: 25000,

  /*
   * Maximum request size.
   * SDP aur ICE candidate ke liye enough hai.
   */
  maxHttpBufferSize: 1e6,

  allowEIO3: true,
});

/*
|--------------------------------------------------------------------------
| Basic routes
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Video Call Signaling Server Running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    connectedUsers: io.engine.clientsCount,
    allowedOrigins,
    timestamp: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| Helper functions
|--------------------------------------------------------------------------
*/

const normalizeRoomId = (roomId) => {
  return String(roomId || "").trim();
};

const getRoomUsers = (roomId) => {
  const room = io.sockets.adapter.rooms.get(roomId);

  return room ? Array.from(room) : [];
};

const isSocketInRoom = (socket, roomId) => {
  return socket.rooms.has(roomId);
};

const emitServerError = (socket, message, code = "SERVER_ERROR") => {
  socket.emit("server-error", {
    success: false,
    code,
    message,
  });
};

/*
|--------------------------------------------------------------------------
| Socket.IO connection
|--------------------------------------------------------------------------
*/

io.on("connection", (socket) => {
  console.log("User Connected:", socket.id);

  /*
  |--------------------------------------------------------------------------
  | Join Room
  |--------------------------------------------------------------------------
  */

  socket.on("join-room", async (rawRoomId, callback) => {
    try {
      const roomId = normalizeRoomId(rawRoomId);

      if (!roomId) {
        const response = {
          success: false,
          code: "ROOM_ID_REQUIRED",
          message: "Room ID is required",
        };

        emitServerError(
          socket,
          response.message,
          response.code,
        );

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      /*
       * Same socket already same room me hai.
       * Duplicate join request ko ignore karenge.
       */
      if (
        socket.data.roomId === roomId &&
        isSocketInRoom(socket, roomId)
      ) {
        const users = getRoomUsers(roomId);

        const response = {
          success: true,
          message: "User already joined this room",
          roomId,
          userId: socket.id,
          totalUsers: users.length,
        };

        socket.emit("room-already-joined", response);

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      /*
       * Agar socket pehle kisi dusre room me tha,
       * to old room leave karwa denge.
       */
      const previousRoomId = socket.data.roomId;

      if (
        previousRoomId &&
        previousRoomId !== roomId
      ) {
        socket.to(previousRoomId).emit("user-left", {
          roomId: previousRoomId,
          userId: socket.id,
          reason: "joined-another-room",
        });

        await socket.leave(previousRoomId);

        console.log(
          `${socket.id} left previous room: ${previousRoomId}`,
        );
      }

      const existingUsers = getRoomUsers(roomId);

      /*
       * One-to-one video call ke liye maximum 2 users.
       */
      if (existingUsers.length >= 2) {
        const response = {
          success: false,
          code: "ROOM_FULL",
          message: "This room already has two users",
          roomId,
        };

        socket.emit("room-full", response);

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      await socket.join(roomId);

      socket.data.roomId = roomId;
      socket.data.joinedAt = new Date().toISOString();

      const usersAfterJoin = getRoomUsers(roomId);

      console.log(
        `${socket.id} joined room: ${roomId}. Total users: ${usersAfterJoin.length}`,
      );

      /*
       * First user room create karega aur wait karega.
       */
      if (existingUsers.length === 0) {
        const response = {
          success: true,
          message: "Room created successfully",
          roomId,
          userId: socket.id,
          role: "initiator",
          totalUsers: usersAfterJoin.length,
        };

        socket.emit("room-created", response);

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      /*
       * Second user room join karega.
       */
      const existingUserId = existingUsers[0];

      const joinResponse = {
        success: true,
        message: "Room joined successfully",
        roomId,
        userId: socket.id,
        existingUserId,
        role: "receiver",
        totalUsers: usersAfterJoin.length,
      };

      socket.emit("room-joined", joinResponse);

      /*
       * Existing user ko event bhejenge.
       * Existing/first user hi offer create karega.
       */
      socket.to(roomId).emit("user-joined", {
        roomId,
        userId: socket.id,
        totalUsers: usersAfterJoin.length,
      });

      if (typeof callback === "function") {
        callback(joinResponse);
      }
    } catch (error) {
      console.error("Join room error:", error);

      const response = {
        success: false,
        code: "JOIN_ROOM_FAILED",
        message: "Unable to join room",
      };

      emitServerError(
        socket,
        response.message,
        response.code,
      );

      if (typeof callback === "function") {
        callback(response);
      }
    }
  });

  /*
  |--------------------------------------------------------------------------
  | WebRTC Offer
  |--------------------------------------------------------------------------
  */

  socket.on("offer", (data = {}, callback) => {
    try {
      const roomId = normalizeRoomId(data.roomId);
      const offer = data.offer;

      if (!roomId) {
        const response = {
          success: false,
          code: "ROOM_ID_REQUIRED",
          message: "Room ID is required",
        };

        emitServerError(
          socket,
          response.message,
          response.code,
        );

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      if (!offer) {
        const response = {
          success: false,
          code: "OFFER_REQUIRED",
          message: "WebRTC offer is required",
        };

        emitServerError(
          socket,
          response.message,
          response.code,
        );

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      if (!isSocketInRoom(socket, roomId)) {
        const response = {
          success: false,
          code: "NOT_IN_ROOM",
          message: "You are not a member of this room",
        };

        emitServerError(
          socket,
          response.message,
          response.code,
        );

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      console.log(
        `Offer sent by ${socket.id} in room ${roomId}`,
      );

      socket.to(roomId).emit("offer", {
        roomId,
        offer,
        sender: socket.id,
      });

      if (typeof callback === "function") {
        callback({
          success: true,
          message: "Offer sent successfully",
        });
      }
    } catch (error) {
      console.error("Offer error:", error);

      if (typeof callback === "function") {
        callback({
          success: false,
          code: "OFFER_FAILED",
          message: "Unable to send offer",
        });
      }
    }
  });

  /*
  |--------------------------------------------------------------------------
  | WebRTC Answer
  |--------------------------------------------------------------------------
  */

  socket.on("answer", (data = {}, callback) => {
    try {
      const roomId = normalizeRoomId(data.roomId);
      const answer = data.answer;

      if (!roomId) {
        const response = {
          success: false,
          code: "ROOM_ID_REQUIRED",
          message: "Room ID is required",
        };

        emitServerError(
          socket,
          response.message,
          response.code,
        );

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      if (!answer) {
        const response = {
          success: false,
          code: "ANSWER_REQUIRED",
          message: "WebRTC answer is required",
        };

        emitServerError(
          socket,
          response.message,
          response.code,
        );

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      if (!isSocketInRoom(socket, roomId)) {
        const response = {
          success: false,
          code: "NOT_IN_ROOM",
          message: "You are not a member of this room",
        };

        emitServerError(
          socket,
          response.message,
          response.code,
        );

        if (typeof callback === "function") {
          callback(response);
        }

        return;
      }

      console.log(
        `Answer sent by ${socket.id} in room ${roomId}`,
      );

      socket.to(roomId).emit("answer", {
        roomId,
        answer,
        sender: socket.id,
      });

      if (typeof callback === "function") {
        callback({
          success: true,
          message: "Answer sent successfully",
        });
      }
    } catch (error) {
      console.error("Answer error:", error);

      if (typeof callback === "function") {
        callback({
          success: false,
          code: "ANSWER_FAILED",
          message: "Unable to send answer",
        });
      }
    }
  });

  /*
  |--------------------------------------------------------------------------
  | ICE Candidate
  |--------------------------------------------------------------------------
  */

  socket.on(
    "ice-candidate",
    (data = {}, callback) => {
      try {
        const roomId = normalizeRoomId(data.roomId);
        const candidate = data.candidate;

        if (!roomId || !candidate) {
          if (typeof callback === "function") {
            callback({
              success: false,
              code: "INVALID_ICE_DATA",
              message:
                "Room ID and ICE candidate are required",
            });
          }

          return;
        }

        if (!isSocketInRoom(socket, roomId)) {
          if (typeof callback === "function") {
            callback({
              success: false,
              code: "NOT_IN_ROOM",
              message:
                "You are not a member of this room",
            });
          }

          return;
        }

        socket.to(roomId).emit("ice-candidate", {
          roomId,
          candidate,
          sender: socket.id,
        });

        if (typeof callback === "function") {
          callback({
            success: true,
            message:
              "ICE candidate sent successfully",
          });
        }
      } catch (error) {
        console.error("ICE candidate error:", error);

        if (typeof callback === "function") {
          callback({
            success: false,
            code: "ICE_CANDIDATE_FAILED",
            message:
              "Unable to send ICE candidate",
          });
        }
      }
    },
  );

  /*
  |--------------------------------------------------------------------------
  | Call End
  |--------------------------------------------------------------------------
  */

  socket.on("end-call", (data = {}, callback) => {
    try {
      const roomId = normalizeRoomId(
        data.roomId || socket.data.roomId,
      );

      if (!roomId) {
        if (typeof callback === "function") {
          callback({
            success: false,
            code: "ROOM_ID_REQUIRED",
            message: "Room ID is required",
          });
        }

        return;
      }

      socket.to(roomId).emit("call-ended", {
        roomId,
        userId: socket.id,
        reason: data.reason || "call-ended",
      });

      console.log(
        `Call ended by ${socket.id} in room ${roomId}`,
      );

      if (typeof callback === "function") {
        callback({
          success: true,
          message: "Call ended successfully",
        });
      }
    } catch (error) {
      console.error("End call error:", error);

      if (typeof callback === "function") {
        callback({
          success: false,
          code: "END_CALL_FAILED",
          message: "Unable to end call",
        });
      }
    }
  });

  /*
  |--------------------------------------------------------------------------
  | Leave Room
  |--------------------------------------------------------------------------
  */

  socket.on(
    "leave-room",
    async (rawRoomId, callback) => {
      try {
        const roomId = normalizeRoomId(
          rawRoomId || socket.data.roomId,
        );

        if (!roomId) {
          if (typeof callback === "function") {
            callback({
              success: false,
              code: "ROOM_ID_REQUIRED",
              message: "Room ID is required",
            });
          }

          return;
        }

        if (!isSocketInRoom(socket, roomId)) {
          socket.data.roomId = null;

          if (typeof callback === "function") {
            callback({
              success: true,
              message:
                "User is already outside the room",
            });
          }

          return;
        }

        socket.to(roomId).emit("user-left", {
          roomId,
          userId: socket.id,
          reason: "manual-leave",
        });

        await socket.leave(roomId);

        if (socket.data.roomId === roomId) {
          socket.data.roomId = null;
          socket.data.joinedAt = null;
        }

        console.log(
          `${socket.id} left room: ${roomId}`,
        );

        if (typeof callback === "function") {
          callback({
            success: true,
            message: "Room left successfully",
            roomId,
          });
        }
      } catch (error) {
        console.error("Leave room error:", error);

        if (typeof callback === "function") {
          callback({
            success: false,
            code: "LEAVE_ROOM_FAILED",
            message: "Unable to leave room",
          });
        }
      }
    },
  );

  /*
  |--------------------------------------------------------------------------
  | Socket Error
  |--------------------------------------------------------------------------
  */

  socket.on("error", (error) => {
    console.error(
      `Socket error for ${socket.id}:`,
      error,
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Disconnecting
  |--------------------------------------------------------------------------
  |
  | disconnecting event me socket abhi rooms me available hota hai.
  |
  */

  socket.on("disconnecting", (reason) => {
    const roomId = socket.data.roomId;

    if (roomId) {
      socket.to(roomId).emit("user-left", {
        roomId,
        userId: socket.id,
        reason: reason || "socket-disconnecting",
      });

      console.log(
        `${socket.id} is disconnecting from room ${roomId}. Reason: ${reason}`,
      );
    }
  });

  /*
  |--------------------------------------------------------------------------
  | Disconnected
  |--------------------------------------------------------------------------
  */

  socket.on("disconnect", (reason) => {
    console.log(
      `User Disconnected: ${socket.id}. Reason: ${reason}`,
    );

    socket.data.roomId = null;
    socket.data.joinedAt = null;
  });
});

/*
|--------------------------------------------------------------------------
| Global error handling
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {
  console.error("Express error:", error);

  if (error.message?.includes("not allowed by CORS")) {
    return res.status(403).json({
      success: false,
      message: error.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT) || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Video Call Signaling Server running on port ${PORT}`,
  );

  console.log("Allowed origins:", allowedOrigins);
});

/*
|--------------------------------------------------------------------------
| Graceful shutdown
|--------------------------------------------------------------------------
*/

const shutdownServer = () => {
  console.log("Shutting down signaling server...");

  io.close(() => {
    server.close(() => {
      console.log("Signaling server stopped");
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error("Forced server shutdown");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", shutdownServer);
process.on("SIGINT", shutdownServer);

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Promise Rejection:", reason);
});
