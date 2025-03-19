import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// Database initialization
let db;
async function initializeDatabase() {
  db = await open({
    filename: "./chat.db",
    driver: sqlite3.Database,
  });

  // Create tables if they don't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS students (
      persistent_id TEXT PRIMARY KEY,
      session_id TEXT,
      username TEXT,
      status TEXT,
      last_active TIMESTAMP,
      socket_id TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      sender TEXT,
      sender_name TEXT,
      text TEXT,
      timestamp TIMESTAMP,
      type TEXT,
      role TEXT,
      recipient TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
  `);

  console.log("Database initialized");
}

// Initialize Express app
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Global error handler for Express routes
app.use((err, req, res, next) => {
  console.error("Express error:", err.stack);
  res.status(500).json({
    error: "Something went wrong on the server",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// In-memory cache for better performance
const chatCache = {};
const roomTeachers = {};
const roomStudents = {};

// Helper function to generate a consistent student ID
function generateStudentId(username, sessionId) {
  return `${sessionId}_${username.toLowerCase().trim()}`;
}

// Routes
app.get("/", (req, res) => {
  res.send("Session server is running");
});

// Get chat history for a specific room and student (only available to teachers)
app.get(
  "/api/session/:sessionId/student/:studentId",
  async (req, res, next) => {
    try {
      const { sessionId, studentId } = req.params;
      const { role } = req.query;

      if (!sessionId || !studentId) {
        return res
          .status(400)
          .json({ error: "Session ID and Student ID are required" });
      }

      // Only teachers can get chat history
      if (role !== "teacher") {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get chat history for specific student from database
      const messages = await db.all(
        `SELECT * FROM messages 
       WHERE session_id = ? AND (
         type = 'notification' OR 
         sender = ? OR 
         (role = 'teacher' AND recipient = ?)
       )
       ORDER BY timestamp ASC`,
        [sessionId, studentId, studentId]
      );

      // Format the messages to ensure consistency with frontend
      const studentChat = messages.map((msg) => ({
        id: msg.id,
        sender: msg.sender,
        senderName: msg.sender_name,
        text: msg.text,
        timestamp: msg.timestamp,
        type: msg.type,
        role: msg.role,
        recipient: msg.recipient,
      }));

      res.json(studentChat);
    } catch (error) {
      next(error);
    }
  }
);

// Get all students in a session (only available to teachers)
app.get("/api/session/:sessionId/students", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { role } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    // Only teachers can get student list
    if (role !== "teacher") {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get students from database
    const dbStudents = await db.all(
      "SELECT * FROM students WHERE session_id = ?",
      [sessionId]
    );

    // Format for frontend consistency
    const students = dbStudents.map((student) => ({
      id: student.socket_id,
      persistentId: student.persistent_id,
      username: student.username,
      status: student.status,
      lastActive: student.last_active,
    }));

    res.json(students);
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate-session", async (req, res) => {
  try {
    // Create a 5-digit numerical code
    let sessionId = "";
    const digits = "0123456789";

    for (let i = 0; i < 5; i++) {
      sessionId += digits.charAt(Math.floor(Math.random() * digits.length));
    }

    // Initialize session in database
    await db.run("INSERT INTO sessions (session_id) VALUES (?)", [sessionId]);

    // Initialize cache
    chatCache[sessionId] = [];
    roomStudents[sessionId] = [];

    res.json({ sessionId });
  } catch (error) {
    console.error("Error generating session:", error);
    res.status(500).json({ error: "Failed to generate session" });
  }
});

// Error handling for Socket.IO server
io.engine.on("connection_error", (err) => {
  console.error("Socket.IO connection error:", err);
});

// Helper function to load chat history from database
async function loadChatHistory(sessionId) {
  if (chatCache[sessionId] && chatCache[sessionId].length > 0) {
    return chatCache[sessionId];
  }

  const messages = await db.all(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
    [sessionId]
  );

  // Format the messages to ensure consistency with frontend
  const formattedMessages = messages.map((msg) => ({
    id: msg.id,
    sender: msg.sender,
    senderName: msg.sender_name,
    text: msg.text,
    timestamp: msg.timestamp,
    type: msg.type,
    role: msg.role,
    recipient: msg.recipient,
  }));

  chatCache[sessionId] = formattedMessages;
  return formattedMessages;
}

// Helper function to load students from database
async function loadStudents(sessionId) {
  if (roomStudents[sessionId] && roomStudents[sessionId].length > 0) {
    return roomStudents[sessionId];
  }

  const dbStudents = await db.all(
    "SELECT * FROM students WHERE session_id = ?",
    [sessionId]
  );

  // Format for frontend consistency
  const students = dbStudents.map((student) => ({
    id: student.socket_id,
    persistentId: student.persistent_id,
    username: student.username,
    status: student.status,
    lastActive: student.last_active,
    sessionId: student.session_id,
  }));

  roomStudents[sessionId] = students;
  return students;
}

// Helper function to save message to database
async function saveMessage(message) {
  await db.run(
    `INSERT INTO messages (id, session_id, sender, sender_name, text, timestamp, type, role, recipient)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.sessionId,
      message.sender,
      message.senderName || null,
      message.text,
      message.timestamp,
      message.type,
      message.role,
      message.recipient || null,
    ]
  );

  // Update cache
  if (!chatCache[message.sessionId]) {
    chatCache[message.sessionId] = [];
  }

  // Store in cache with the format expected by the frontend
  const cacheMessage = {
    id: message.id,
    sender: message.sender,
    senderName: message.senderName,
    text: message.text,
    timestamp: message.timestamp,
    type: message.type,
    role: message.role,
    recipient: message.recipient,
  };

  chatCache[message.sessionId].push(cacheMessage);
}

// Helper function to save or update student
async function saveStudent(student) {
  const existing = await db.get(
    "SELECT * FROM students WHERE persistent_id = ?",
    [student.persistentId]
  );

  if (existing) {
    await db.run(
      `UPDATE students 
       SET username = ?, status = ?, last_active = ?, socket_id = ?
       WHERE persistent_id = ?`,
      [
        student.username,
        student.status,
        student.lastActive,
        student.id,
        student.persistentId,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO students (persistent_id, session_id, username, status, last_active, socket_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        student.persistentId,
        student.sessionId,
        student.username,
        student.status,
        student.lastActive,
        student.id,
      ]
    );
  }
}

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Error handling for this socket
  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  // Handle joining a room
  socket.on(
    "join_room",
    async (sessionId, username, role, persistentStudentId = null) => {
      try {
        // Validate input
        if (!sessionId) {
          socket.emit("error", { message: "Room ID is required" });
          return;
        }

        const sanitizedUsername = username || "Anonymous";
        const userRole = role || "student";

        // Join the socket.io room
        socket.join(sessionId);

        // Generate or use provided persistent student ID
        let studentId = persistentStudentId;
        if (userRole === "student" && !studentId) {
          studentId = generateStudentId(sanitizedUsername, sessionId);
        }

        // Store room info on the socket for disconnection handling
        socket.userData = {
          currentRoom: sessionId,
          username: sanitizedUsername,
          role: userRole,
          socketId: socket.id,
          persistentId: studentId,
        };

        // Check if session exists in database, if not create it
        const session = await db.get(
          "SELECT * FROM sessions WHERE session_id = ?",
          [sessionId]
        );

        if (!session) {
          await db.run("INSERT INTO sessions (session_id) VALUES (?)", [
            sessionId,
          ]);
        }

        // Load chat history from database if not in cache
        if (!chatCache[sessionId]) {
          await loadChatHistory(sessionId);
        }

        // Load students from database if not in cache
        if (!roomStudents[sessionId]) {
          await loadStudents(sessionId);
        }

        // If this is a teacher, store their socket ID
        if (userRole === "teacher") {
          roomTeachers[sessionId] = socket.id;

          // Send the current student list to the teacher
          socket.emit("student_list", roomStudents[sessionId]);
        } else {
          // If this is a student, check if they already exist using persistent ID
          const existingStudentIndex = roomStudents[sessionId].findIndex(
            (s) => s.persistentId === studentId
          );

          if (existingStudentIndex >= 0) {
            // Update existing student info but preserve the persistent ID
            const existingStudent =
              roomStudents[sessionId][existingStudentIndex];
            roomStudents[sessionId][existingStudentIndex] = {
              ...existingStudent,
              id: socket.id,
              username: sanitizedUsername,
              status: "online",
              lastActive: new Date().toISOString(),
              sessionId: sessionId,
            };

            // Update in database
            await saveStudent(roomStudents[sessionId][existingStudentIndex]);

            console.log(
              `Student ${sanitizedUsername} reconnected to room ${sessionId} with ID ${studentId}`
            );
          } else {
            // Add new student to the list with persistent ID
            const studentInfo = {
              id: socket.id,
              persistentId: studentId,
              sessionId: sessionId,
              username: sanitizedUsername,
              status: "online",
              lastActive: new Date().toISOString(),
            };
            roomStudents[sessionId].push(studentInfo);

            // Save to database
            await saveStudent(studentInfo);

            console.log(
              `New student ${sanitizedUsername} joined room ${sessionId} with ID ${studentId}`
            );
          }

          // Notify teacher about new/updated student
          if (roomTeachers[sessionId]) {
            io.to(roomTeachers[sessionId]).emit(
              "student_list",
              roomStudents[sessionId]
            );
          }
        }

        // Notify about user joining
        const joinMessage = {
          id: Date.now().toString(),
          sessionId: sessionId,
          sender: "system",
          senderName: "System",
          text: `${sanitizedUsername} has joined as ${userRole}`,
          timestamp: new Date().toISOString(),
          type: "notification",
          role: userRole,
        };

        // Save to database
        await saveMessage(joinMessage);

        // Only send the message to the teacher and the joining user
        if (roomTeachers[sessionId]) {
          io.to(roomTeachers[sessionId]).emit("message", joinMessage);
        }

        socket.emit("message", joinMessage);

        // *** IMPORTANT: THIS IS THE KEY CHANGE ***
        // Send chat history to the joining user
        // Now we send ALL messages to students instead of filtering
        if (userRole === "student") {
          // Send ALL chat history to students
          const formattedHistory = chatCache[sessionId].map((msg) => ({
            id: msg.id || Date.now().toString(),
            sender: msg.sender,
            senderName: msg.senderName,
            text: msg.text,
            timestamp: msg.timestamp,
            type: msg.type,
            role: msg.role,
          }));

          socket.emit("chat_history", formattedHistory);
        } else if (userRole === "teacher") {
          // Teachers already get all messages
          const formattedHistory = chatCache[sessionId].map((msg) => ({
            id: msg.id || Date.now().toString(),
            sender: msg.sender,
            senderName: msg.senderName,
            text: msg.text,
            timestamp: msg.timestamp,
            type: msg.type,
            role: msg.role,
          }));

          socket.emit("chat_history", formattedHistory);
        }
      } catch (error) {
        console.error("Error joining room:", error);
        socket.emit("error", { message: "Failed to join room" });
      }
    }
  );

  // Handle new messages
  socket.on("send_message", async (messageData) => {
    try {
      if (!messageData || !messageData.sessionId || !messageData.message) {
        socket.emit("error", { message: "Invalid message format" });
        return;
      }

      const { sessionId, message, recipient, studentId } = messageData;
      const userRole = socket.userData?.role || "student";

      // Use persistent ID if available for students, otherwise use socket ID
      const senderId =
        userRole === "student" && studentId ? studentId : socket.id;

      // Format the message
      const formattedMessage = {
        id: message.id || Date.now().toString(),
        sessionId: sessionId,
        sender: senderId,
        senderName: message.sender || socket.userData?.username || "Anonymous",
        text:
          typeof message.text === "string"
            ? message.text
            : String(message.text || ""),
        timestamp: message.timestamp || new Date().toISOString(),
        type: "message",
        role: userRole,
        recipient: recipient || null,
      };

      // Save to database
      await saveMessage(formattedMessage);

      // If sender is teacher, send only to the specific student
      if (userRole === "teacher" && recipient) {
        // Find student's current socket ID using their persistent ID
        const student = roomStudents[sessionId]?.find(
          (s) => s.persistentId === recipient || s.id === recipient
        );
        if (student) {
          io.to(student.id).emit("message", {
            ...formattedMessage,
            sender: "teacher",
          });
        }
        socket.emit("message", formattedMessage);
      } else if (userRole === "student") {
        // If sender is student, send only to teacher
        if (roomTeachers[sessionId]) {
          io.to(roomTeachers[sessionId]).emit("message", formattedMessage);
        }
        socket.emit("message", {
          ...formattedMessage,
          sender: socket.userData.username,
        });
      }

      // Update student's last activity time
      if (userRole === "student") {
        const studentIndex = roomStudents[sessionId]?.findIndex(
          (s) =>
            (studentId && s.persistentId === studentId) || s.id === socket.id
        );
        if (studentIndex >= 0) {
          roomStudents[sessionId][studentIndex].lastActive =
            new Date().toISOString();
          roomStudents[sessionId][studentIndex].status = "active";

          // Update in database
          await saveStudent(roomStudents[sessionId][studentIndex]);

          // Notify teacher about updated student status
          if (roomTeachers[sessionId]) {
            io.to(roomTeachers[sessionId]).emit(
              "student_list",
              roomStudents[sessionId]
            );
          }
        }
      }
    } catch (error) {
      console.error("Error handling message:", error);
      socket.emit("error", { message: "Failed to process message" });
    }
  });

  // Handle typing status
  socket.on("typing", (data) => {
    const { sessionId, username, isTyping, recipient, studentId } = data;
    const userRole = socket.userData?.role || "student";

    // If student is typing, only notify teacher
    if (userRole === "student" && roomTeachers[sessionId]) {
      // Use persistent ID if available, otherwise use socket ID
      const typingStudentId = studentId || socket.id;
      io.to(roomTeachers[sessionId]).emit("user_typing", {
        username,
        isTyping,
        studentId: typingStudentId,
      });
    }
    // If teacher is typing, notify specific student
    else if (userRole === "teacher" && recipient) {
      // Find student's current socket ID using their persistent ID
      const student = roomStudents[sessionId]?.find(
        (s) => s.persistentId === recipient || s.id === recipient
      );
      if (student) {
        io.to(student.id).emit("user_typing", { username, isTyping });
      }
    }
  });

  // Handle selecting a student to chat with (teacher only)
  socket.on("select_student", async (sessionId, studentId) => {
    try {
      const userRole = socket.userData?.role;

      if (userRole !== "teacher") {
        socket.emit("error", { message: "Only teachers can select students" });
        return;
      }

      // Find student using either persistent ID or socket ID
      const student = roomStudents[sessionId]?.find(
        (s) => s.persistentId === studentId || s.id === studentId
      );
      const effectiveStudentId = student
        ? student.persistentId || student.id
        : studentId;

      // Get chat history for specific student from database
      const messages = await db.all(
        `SELECT * FROM messages 
         WHERE session_id = ? AND (
           type = 'notification' OR 
           sender = ? OR 
           (role = 'teacher' AND recipient = ?)
         )
         ORDER BY timestamp ASC`,
        [sessionId, effectiveStudentId, effectiveStudentId]
      );

      // Format the messages to ensure consistency with frontend
      const studentChat = messages.map((msg) => ({
        id: msg.id,
        sender: msg.sender,
        senderName: msg.sender_name,
        text: msg.text,
        timestamp: msg.timestamp,
        type: msg.type,
        role: msg.role,
        recipient: msg.recipient,
      }));

      // Send chat history to teacher with the ID that was requested
      socket.emit("student_chat_history", { studentId, chat: studentChat });
    } catch (error) {
      console.error("Error selecting student:", error);
      socket.emit("error", { message: "Failed to select student" });
    }
  });

  // Handle user leaving
  socket.on("leave_room", async (sessionId, username, studentId = null) => {
    try {
      const userRole = socket.userData?.role || "student";

      // Notify about user leaving
      const leaveMessage = {
        id: Date.now().toString(),
        sessionId: sessionId,
        sender: "system",
        senderName: "System",
        text: `${username} has left the room`,
        timestamp: new Date().toISOString(),
        type: "notification",
        role: userRole,
      };

      // Save to database
      await saveMessage(leaveMessage);

      // If teacher left, notify all students
      if (userRole === "teacher") {
        io.to(sessionId).emit("message", leaveMessage);
        delete roomTeachers[sessionId];
      }
      // If student left, notify only teacher and update student list
      else if (roomTeachers[sessionId]) {
        io.to(roomTeachers[sessionId]).emit("message", leaveMessage);

        // Update student status in database and cache
        if (roomStudents[sessionId]) {
          let studentToUpdate;

          if (studentId) {
            studentToUpdate = roomStudents[sessionId].find(
              (s) => s.persistentId === studentId
            );
            if (studentToUpdate) {
              studentToUpdate.status = "offline";
              studentToUpdate.lastActive = new Date().toISOString();
              await saveStudent(studentToUpdate);
            }

            // Update cache
            roomStudents[sessionId] = roomStudents[sessionId].filter(
              (s) => s.persistentId !== studentId
            );
          } else {
            studentToUpdate = roomStudents[sessionId].find(
              (s) => s.id === socket.id
            );
            if (studentToUpdate) {
              studentToUpdate.status = "offline";
              studentToUpdate.lastActive = new Date().toISOString();
              await saveStudent(studentToUpdate);
            }

            // Update cache
            roomStudents[sessionId] = roomStudents[sessionId].filter(
              (s) => s.id !== socket.id
            );
          }

          // Notify teacher about updated student list
          io.to(roomTeachers[sessionId]).emit(
            "student_list",
            roomStudents[sessionId]
          );
        }
      }

      socket.leave(sessionId);
      console.log(`${username} left room: ${sessionId}`);
    } catch (error) {
      console.error("Error leaving room:", error);
      socket.emit("error", { message: "Failed to leave room" });
    }
  });

  // Handle disconnection
  socket.on("disconnect", async () => {
    try {
      const userData = socket.userData;

      if (userData && userData.currentRoom) {
        // If this was a teacher, remove them from the room teachers map
        if (
          userData.role === "teacher" &&
          roomTeachers[userData.currentRoom] === socket.id
        ) {
          delete roomTeachers[userData.currentRoom];
        }
        // If this was a student, update their status in the student list
        else if (userData.role === "student") {
          const sessionId = userData.currentRoom;

          // Try to find student by persistent ID first, then by socket ID
          const studentIndex = roomStudents[sessionId]?.findIndex(
            (s) =>
              (userData.persistentId &&
                s.persistentId === userData.persistentId) ||
              s.id === socket.id
          );

          if (studentIndex >= 0) {
            roomStudents[sessionId][studentIndex].status = "offline";
            roomStudents[sessionId][studentIndex].lastActive =
              new Date().toISOString();

            // Update in database
            await saveStudent(roomStudents[sessionId][studentIndex]);

            // Notify teacher about updated student status
            if (roomTeachers[sessionId]) {
              io.to(roomTeachers[sessionId]).emit(
                "student_list",
                roomStudents[sessionId]
              );
            }
          }
        }

        // Add disconnect message
        const disconnectMessage = {
          id: Date.now().toString(),
          sessionId: userData.currentRoom,
          sender: "system",
          senderName: "System",
          text: `${userData.username} has disconnected`,
          timestamp: new Date().toISOString(),
          type: "notification",
          role: userData.role,
        };

        // Save to database
        await saveMessage(disconnectMessage);

        // Notify appropriate users
        if (userData.role === "teacher") {
          io.to(userData.currentRoom).emit("message", disconnectMessage);
        } else if (roomTeachers[userData.currentRoom]) {
          io.to(roomTeachers[userData.currentRoom]).emit(
            "message",
            disconnectMessage
          );
        }
      }

      console.log("Client disconnected:", socket.id);
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;

// Initialize database and start server
(async () => {
  try {
    await initializeDatabase();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();
