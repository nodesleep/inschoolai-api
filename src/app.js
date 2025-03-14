const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*", // In production, specify your frontend URL
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Global error handler for Express routes
app.use((err, req, res, next) => {
  console.error("Express error:", err.stack);
  res.status(500).json({
    error: "Something went wrong on the server",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// In-memory storage for messages (replace with database in production)
const chatHistory = {};

// Routes
app.get("/", (req, res) => {
  res.send("Chat server is running");
});

// Get chat history for a specific room
app.get("/api/chat/:roomId", (req, res, next) => {
  try {
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({ error: "Room ID is required" });
    }

    res.json(chatHistory[roomId] || []);
  } catch (error) {
    next(error); // Pass to the error handler
  }
});

// Error handling for Socket.IO server
io.engine.on("connection_error", (err) => {
  console.error("Socket.IO connection error:", err);
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Setup error handling for this socket
  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  // Handle joining a room
  socket.on("join_room", (roomId, username) => {
    try {
      // Validate input
      if (!roomId) {
        socket.emit("error", { message: "Room ID is required" });
        return;
      }

      const sanitizedUsername = username || "Anonymous";

      // Join the socket.io room
      socket.join(roomId);

      // Store room info on the socket for disconnection handling
      socket.userData = {
        currentRoom: roomId,
        username: sanitizedUsername,
      };

      // Initialize room history if it doesn't exist
      if (!chatHistory[roomId]) {
        chatHistory[roomId] = [];
      }

      // Send room history to the newly connected user
      socket.emit("chat_history", chatHistory[roomId]);

      // Notify others that user has joined
      const joinMessage = {
        id: Date.now().toString(),
        sender: "system",
        text: `${sanitizedUsername} has joined the room`,
        timestamp: new Date().toISOString(),
        type: "notification",
      };

      chatHistory[roomId].push(joinMessage);
      io.to(roomId).emit("message", joinMessage);

      console.log(`${sanitizedUsername} joined room: ${roomId}`);
    } catch (error) {
      console.error("Error joining room:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  // Handle new messages
  socket.on("send_message", (messageData) => {
    try {
      // Log received message data for debugging
      console.log("Received message data:", JSON.stringify(messageData));

      // Validate input
      if (!messageData || !messageData.roomId || !messageData.message) {
        console.error("Invalid message format received:", messageData);
        socket.emit("error", { message: "Invalid message format" });
        return;
      }

      const { roomId, message } = messageData;

      // Further validation
      if (!message.sender || !message.text) {
        console.error("Message missing required fields:", message);
        socket.emit("error", {
          message: "Message must include sender and text",
        });
        return;
      }

      // Check if room exists
      if (!chatHistory[roomId]) {
        chatHistory[roomId] = [];
      }

      // Format the message
      const formattedMessage = {
        id: Date.now().toString(),
        sender: message.sender || "Anonymous",
        text:
          typeof message.text === "string"
            ? message.text
            : String(message.text || ""),
        timestamp: new Date().toISOString(),
        type: "message",
      };

      // Save to history
      chatHistory[roomId].push(formattedMessage);

      // Limit history size (optional)
      if (chatHistory[roomId].length > 100) {
        chatHistory[roomId] = chatHistory[roomId].slice(-100);
      }

      // Broadcast to everyone in the room
      io.to(roomId).emit("message", formattedMessage);
    } catch (error) {
      console.error("Error handling message:", error);
      socket.emit("error", { message: "Failed to process message" });
    }
  });

  // Handle typing status
  socket.on("typing", (data) => {
    const { roomId, username, isTyping } = data;

    // Broadcast typing status to everyone else in the room
    socket.to(roomId).emit("user_typing", { username, isTyping });
  });

  // Handle user leaving
  socket.on("leave_room", (roomId, username) => {
    // Notify others that user has left
    if (chatHistory[roomId]) {
      const leaveMessage = {
        id: Date.now().toString(),
        sender: "system",
        text: `${username} has left the room`,
        timestamp: new Date().toISOString(),
        type: "notification",
      };

      chatHistory[roomId].push(leaveMessage);
      io.to(roomId).emit("message", leaveMessage);
    }

    socket.leave(roomId);
    console.log(`${username} left room: ${roomId}`);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    try {
      console.log("Client disconnected:", socket.id);

      // Clean up user data and notify room if needed
      if (socket.userData && socket.userData.currentRoom) {
        const { currentRoom, username } = socket.userData;

        // Notify room that user has disconnected
        if (chatHistory[currentRoom]) {
          const disconnectMessage = {
            id: Date.now().toString(),
            sender: "system",
            text: `${username || "A user"} has disconnected`,
            timestamp: new Date().toISOString(),
            type: "notification",
          };

          chatHistory[currentRoom].push(disconnectMessage);
          io.to(currentRoom).emit("message", disconnectMessage);
        }
      }
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  });
});

// Process-level error handling
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Log to a file or monitoring service in production
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Log to a file or monitoring service in production
});

// Start the server
const PORT = process.env.PORT || 3001;
server
  .listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  })
  .on("error", (error) => {
    console.error("Server failed to start:", error);
  });
