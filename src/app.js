const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
require("dotenv").config();

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

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

// Registration endpoint for creating new Firebase accounts
app.post("/api/register", async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    console.log(`Attempting to register user: ${email}`);

    // Firebase Auth REST API endpoint for creating a new user account
    const registrationUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;
    console.log(
      `Sending registration request to: ${registrationUrl.split("?")[0]}`,
    );

    // First, create the user account
    const response = await axios.post(registrationUrl, {
      email,
      password,
      returnSecureToken: true,
    });

    // Extract the user ID, ID token and email from Firebase response
    const { localId, idToken, email: userEmail } = response.data;

    // If displayName is provided, update the user profile
    if (displayName) {
      const updateProfileUrl = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_API_KEY}`;

      await axios.post(updateProfileUrl, {
        idToken,
        displayName,
        returnSecureToken: true,
      });

      console.log(
        `Updated profile for user: ${userEmail} with display name: ${displayName}`,
      );
    }

    console.log(`Registration successful for: ${userEmail}`);

    // Return the user info and JWT
    res.status(201).json({
      message: "User registered successfully",
      uid: localId,
      email: userEmail,
      jwt: idToken,
      displayName: displayName || null,
    });
  } catch (error) {
    console.error("Firebase Registration Error Details:");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data));
      console.error("Headers:", JSON.stringify(error.response.headers));
    } else if (error.request) {
      console.error("No response received:", error.request);
    } else {
      console.error("Error:", error.message);
    }

    // Handle specific Firebase registration errors
    if (error.response?.data?.error?.message) {
      const firebaseError = error.response.data.error.message;
      let errorMessage = "Registration failed";
      let statusCode = 400;

      // Map Firebase error codes to user-friendly messages
      switch (firebaseError) {
        case "EMAIL_EXISTS":
          errorMessage = "The email address is already in use";
          break;
        case "OPERATION_NOT_ALLOWED":
          errorMessage = "Password sign-up is disabled for this project";
          break;
        case "TOO_MANY_ATTEMPTS_TRY_LATER":
          errorMessage = "Too many attempts, please try again later";
          statusCode = 429;
          break;
        case "INVALID_API_KEY":
          errorMessage = "Invalid API key configuration";
          statusCode = 500;
          break;
        case "WEAK_PASSWORD":
          errorMessage = "Password should be at least 6 characters";
          break;
        default:
          errorMessage = "Registration failed";
      }

      return res.status(statusCode).json({
        error: errorMessage,
        code: firebaseError,
      });
    }

    res.status(500).json({
      error: "Registration failed",
      message:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Firebase Authentication Endpoint with email/password
app.post("/api/auth", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Firebase Auth REST API endpoint for sign-in with email/password
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        email,
        password,
        returnSecureToken: true,
      },
    );

    // Extract the ID token and user email from the Firebase response
    const { idToken, email: userEmail } = response.data;

    // Return the user's email and the JWT (idToken)
    res.json({
      email: userEmail,
      jwt: idToken,
    });
  } catch (error) {
    console.error(
      "Firebase Auth Error:",
      error.response?.data || error.message,
    );

    // Handle specific Firebase auth errors
    if (error.response?.data?.error?.message) {
      const firebaseError = error.response.data.error.message;
      let errorMessage = "Authentication failed";

      // Map Firebase error codes to user-friendly messages
      switch (firebaseError) {
        case "EMAIL_NOT_FOUND":
          errorMessage = "Email not found";
          break;
        case "INVALID_PASSWORD":
          errorMessage = "Invalid password";
          break;
        case "USER_DISABLED":
          errorMessage = "User account has been disabled";
          break;
        default:
          errorMessage = "Authentication failed";
      }

      return res.status(401).json({
        error: errorMessage,
        code: firebaseError,
      });
    }

    res.status(401).json({
      error: "Authentication failed",
      message:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

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
  // Get the client's IP address
  const clientIp =
    socket.handshake.headers["x-forwarded-for"] ||
    socket.handshake.address ||
    socket.conn.remoteAddress;

  console.log("New client connected:", socket.id, "from IP:", clientIp);

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
      const clientIp =
        socket.handshake.headers["x-forwarded-for"] ||
        socket.handshake.address ||
        socket.conn.remoteAddress;

      // Join the socket.io room
      socket.join(roomId);

      // Store room info and IP on the socket for tracking and disconnection handling
      socket.userData = {
        currentRoom: roomId,
        username: sanitizedUsername,
        ip: clientIp,
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

      console.log(
        `${sanitizedUsername} (IP: ${clientIp}) joined room: ${roomId}`,
      );
    } catch (error) {
      console.error("Error joining room:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  // Handle send_message event with IP logging
  socket.on("send_message", (messageData) => {
    try {
      // Log received message data for debugging
      console.log("Received message data:", JSON.stringify(messageData));

      // Get the client's IP address
      const clientIp =
        socket.userData?.ip ||
        socket.handshake.headers["x-forwarded-for"] ||
        socket.handshake.address ||
        socket.conn.remoteAddress;

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

      // Log message with IP address
      console.log(
        `Message from ${message.sender} (IP: ${clientIp}) in room ${roomId}: ${message.text}`,
      );

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
