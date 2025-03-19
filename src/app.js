import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

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
app.use(express.static("public")); // Serve static files from public directory

// Global error handler for Express routes
app.use((err, req, res, next) => {
  console.error("Express error:", err.stack);
  res.status(500).json({
    error: "Something went wrong on the server",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// In-memory storage for messages, room info, and students
const chatHistory = {};
const roomTeachers = {}; // Map session IDs to teacher socket IDs
const roomStudents = {}; // Map session IDs to connected students

// Helper function to generate a consistent student ID
function generateStudentId(username, sessionId) {
  return `${sessionId}_${username.toLowerCase().trim()}`;
}

// Routes
app.get("/", (req, res) => {
  res.send("Session server is running");
});

// Get chat history for a specific room and student (only available to teachers)
app.get("/api/session/:sessionId/student/:studentId", (req, res, next) => {
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

    // Get chat history for specific student
    const studentChat =
      chatHistory[sessionId]?.filter(
        (msg) =>
          msg.type === "notification" ||
          msg.sender === studentId ||
          (msg.role === "teacher" && msg.recipient === studentId)
      ) || [];

    res.json(studentChat);
  } catch (error) {
    next(error);
  }
});

// Get all students in a session (only available to teachers)
app.get("/api/session/:sessionId/students", (req, res, next) => {
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

    const students = roomStudents[sessionId] || [];
    res.json(students);
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate-session", (req, res) => {
  // Create a 5-digit numerical code
  let sessionId = "";
  const digits = "0123456789";

  for (let i = 0; i < 5; i++) {
    sessionId += digits.charAt(Math.floor(Math.random() * digits.length));
  }

  // Initialize session
  chatHistory[sessionId] = [];
  roomStudents[sessionId] = [];

  res.json({ sessionId });
});

// Error handling for Socket.IO server
io.engine.on("connection_error", (err) => {
  console.error("Socket.IO connection error:", err);
});

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
    (sessionId, username, role, persistentStudentId = null) => {
      try {
        // Validate input
        if (!sessionId) {
          socket.emit("error", { message: "Room ID is required" });
          return;
        }

        const sanitizedUsername = username || "Anonymous";
        const userRole = role || "student"; // Default to student

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
          persistentId: studentId, // Store the persistent ID for students
        };

        // Initialize room history if it doesn't exist
        if (!chatHistory[sessionId]) {
          chatHistory[sessionId] = [];
        }

        // Initialize student list if it doesn't exist
        if (!roomStudents[sessionId]) {
          roomStudents[sessionId] = [];
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
              id: socket.id, // Update to the new socket ID
              username: sanitizedUsername,
              status: "online",
              lastActive: new Date().toISOString(),
            };

            console.log(
              `Student ${sanitizedUsername} reconnected to room ${sessionId} with ID ${studentId}`
            );
          } else {
            // Add new student to the list with persistent ID
            const studentInfo = {
              id: socket.id,
              persistentId: studentId, // Store persistent ID
              username: sanitizedUsername,
              status: "online",
              lastActive: new Date().toISOString(),
            };
            roomStudents[sessionId].push(studentInfo);

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
          sender: "system",
          text: `${sanitizedUsername} has joined as ${userRole}`,
          timestamp: new Date().toISOString(),
          type: "notification",
          role: userRole,
        };

        chatHistory[sessionId].push(joinMessage);

        // Only send the message to the teacher and the joining user
        if (roomTeachers[sessionId]) {
          io.to(roomTeachers[sessionId]).emit("message", joinMessage);
        }

        socket.emit("message", joinMessage);
      } catch (error) {
        console.error("Error joining room:", error);
        socket.emit("error", { message: "Failed to join room" });
      }
    }
  );

  // Handle new messages
  socket.on("send_message", (messageData) => {
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

      // Check if room exists
      if (!chatHistory[sessionId]) {
        chatHistory[sessionId] = [];
      }

      // Format the message
      const formattedMessage = {
        id: Date.now().toString(),
        sender: senderId, // Use persistent ID for students when available
        senderName: message.sender || "Anonymous", // Add sender name for display
        text:
          typeof message.text === "string"
            ? message.text
            : String(message.text || ""),
        timestamp: new Date().toISOString(),
        type: "message",
        role: userRole,
        recipient: recipient || null,
      };

      // Save to history
      chatHistory[sessionId].push(formattedMessage);

      // Limit history size (optional)
      if (chatHistory[sessionId].length > 100) {
        chatHistory[sessionId] = chatHistory[sessionId].slice(-100);
      }

      // If sender is teacher, send only to the specific student
      if (userRole === "teacher" && recipient) {
        // Find student's current socket ID using their persistent ID
        const student = roomStudents[sessionId]?.find(
          (s) => s.persistentId === recipient || s.id === recipient
        );
        if (student) {
          io.to(student.id).emit("message", {
            ...formattedMessage,
            sender: "teacher", // Override sender ID with "teacher" for client display
          });
        }
        socket.emit("message", formattedMessage); // Also send to teacher
      } else if (userRole === "student") {
        // If sender is student, send only to teacher
        if (roomTeachers[sessionId]) {
          io.to(roomTeachers[sessionId]).emit("message", formattedMessage);
        }
        socket.emit("message", {
          ...formattedMessage,
          sender: socket.userData.username, // Use username for display on student side
        }); // Also send to student
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
  socket.on("select_student", (sessionId, studentId) => {
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

      // Get chat history for specific student
      const studentChat =
        chatHistory[sessionId]?.filter(
          (msg) =>
            msg.type === "notification" ||
            msg.sender === effectiveStudentId ||
            (msg.role === "teacher" && msg.recipient === effectiveStudentId)
        ) || [];

      // Send chat history to teacher with the ID that was requested
      socket.emit("student_chat_history", { studentId, chat: studentChat });
    } catch (error) {
      console.error("Error selecting student:", error);
      socket.emit("error", { message: "Failed to select student" });
    }
  });

  // Handle user leaving
  socket.on("leave_room", (sessionId, username, studentId = null) => {
    const userRole = socket.userData?.role || "student";

    // Notify about user leaving
    if (chatHistory[sessionId]) {
      const leaveMessage = {
        id: Date.now().toString(),
        sender: "system",
        text: `${username} has left the room`,
        timestamp: new Date().toISOString(),
        type: "notification",
        role: userRole,
      };

      chatHistory[sessionId].push(leaveMessage);

      // If teacher left, notify all students
      if (userRole === "teacher") {
        io.to(sessionId).emit("message", leaveMessage);
        delete roomTeachers[sessionId];
      }
      // If student left, notify only teacher and update student list
      else if (roomTeachers[sessionId]) {
        io.to(roomTeachers[sessionId]).emit("message", leaveMessage);

        // Remove student from list using persistent ID if provided
        if (roomStudents[sessionId]) {
          if (studentId) {
            roomStudents[sessionId] = roomStudents[sessionId].filter(
              (s) => s.persistentId !== studentId
            );
          } else {
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
    }

    socket.leave(sessionId);
    console.log(`${username} left room: ${sessionId}`);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
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
      if (chatHistory[userData.currentRoom]) {
        const disconnectMessage = {
          id: Date.now().toString(),
          sender: "system",
          text: `${userData.username} has disconnected`,
          timestamp: new Date().toISOString(),
          type: "notification",
          role: userData.role,
        };

        chatHistory[userData.currentRoom].push(disconnectMessage);

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
    }

    console.log("Client disconnected:", socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3023;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
