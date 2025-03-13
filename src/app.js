const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Global error handler for Express routes, keeps the server running in the event of an error.
app.use((err, req, res, next) => {
  console.error("Express error:", err.stack);
  res.status(500).json({
    error: "Something went wrong on the server",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// In-memory storage for messages (replace with database or Redis in production)
const chatHistory = {};

// Routes
app.get("/", (req, res) => {
  res.send("Session server is running");
});

// Get chat history for a specific room
app.get("/api/session/:sessionId", (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    res.json(chatHistory[sessionId] || []);
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
  socket.on("join_room", (sessionId, username) => {
    try {
      // Validate input
      if (!sessionId) {
        socket.emit("error", { message: "Room ID is required" });
        return;
      }

      const sanitizedUsername = username || "Anonymous";

      // Join the socket.io room
      socket.join(sessionId);

      // Store room info on the socket for disconnection handling
      socket.userData = {
        currentRoom: sessionId,
        username: sanitizedUsername,
      };

      // Initialize room history if it doesn't exist
      if (!chatHistory[sessionId]) {
        chatHistory[sessionId] = [];
      }

      // Send room history to the newly connected user
      socket.emit("chat_history", chatHistory[sessionId]);

      // Notify others that user has joined
      const joinMessage = {
        id: Date.now().toString(),
        sender: "system",
        text: `${sanitizedUsername} has joined the room`,
        timestamp: new Date().toISOString(),
        type: "notification",
      };

      chatHistory[sessionId].push(joinMessage);
      io.to(sessionId).emit("message", joinMessage);

      console.log(`${sanitizedUsername} joined room: ${sessionId}`);
    } catch (error) {
      console.error("Error joining room:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  // Handle new messages
  socket.on("send_message", (messageData) => {
    try {
      // Input must always be validated to reduce exploit potential
      // We should consider a library for this in production
      if (!messageData || !messageData.sessionId || !messageData.message) {
        socket.emit("error", { message: "Invalid message format" });
        return;
      }

      const { sessionId, message } = messageData;

      // Check if room exists
      if (!chatHistory[sessionId]) {
        chatHistory[sessionId] = [];
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
      chatHistory[sessionId].push(formattedMessage);

      // Limit history size (optional)
      if (chatHistory[sessionId].length > 100) {
        chatHistory[sessionId] = chatHistory[sessionId].slice(-100);
      }

      // Broadcast to everyone in the room
      io.to(sessionId).emit("message", formattedMessage);
    } catch (error) {
      console.error("Error handling message:", error);
      socket.emit("error", { message: "Failed to process message" });
    }
  });

  // Handle typing status
  socket.on("typing", (data) => {
    const { sessionId, username, isTyping } = data;

    // Broadcast typing status to everyone else in the room
    socket.to(sessionId).emit("user_typing", { username, isTyping });
  });

  // Handle user leaving
  socket.on("leave_room", (sessionId, username) => {
    // Notify others that user has left
    if (chatHistory[sessionId]) {
      const leaveMessage = {
        id: Date.now().toString(),
        sender: "system",
        text: `${username} has left the room`,
        timestamp: new Date().toISOString(),
        type: "notification",
      };

      chatHistory[sessionId].push(leaveMessage);
      io.to(sessionId).emit("message", leaveMessage);
    }

    socket.leave(sessionId);
    console.log(`${username} left room: ${sessionId}`);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
