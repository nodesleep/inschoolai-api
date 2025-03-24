import { Server } from "socket.io";
import {
  generateStudentId,
  generateUniqueMessageId,
  formatMessage,
} from "../utils/helpers.js";
import { saveStudent, findStudent, removeStudent } from "../models/student.js";
import {
  saveMessage,
  getStudentMessages,
  getStudentRelevantMessages,
} from "../models/message.js";
import { ensureSessionExists } from "../models/session.js";
import * as chatService from "./chat.js";

let io;

// Setup Socket.IO server
export function setupSocketServer(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Error handling for Socket.IO server
  io.engine.on("connection_error", (err) => {
    console.error("Socket.IO connection error:", err);
  });

  // Handle new connections
  io.on("connection", handleConnection);

  return io;
}

// Connection handler
function handleConnection(socket) {
  console.log("New client connected:", socket.id);

  // Error handling for this socket
  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  // Register event handlers
  socket.on(
    "join_room",
    (sessionId, username, role, persistentStudentId = null) =>
      handleJoinRoom(socket, sessionId, username, role, persistentStudentId)
  );

  socket.on("send_message", (messageData) =>
    handleSendMessage(socket, messageData)
  );

  socket.on("typing", (data) => handleTypingStatus(socket, data));

  socket.on("select_student", (sessionId, studentId) =>
    handleSelectStudent(socket, sessionId, studentId)
  );

  socket.on("kick_student", (data) => handleKickStudent(socket, data));

  socket.on("leave_room", (sessionId, username, studentId = null) =>
    handleLeaveRoom(socket, sessionId, username, studentId)
  );

  socket.on("disconnect", () => handleDisconnect(socket));
}

// Handle joining a room
async function handleJoinRoom(
  socket,
  sessionId,
  username,
  role,
  persistentStudentId = null
) {
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

    if (userRole === "student") {
      // Load students from database/cache
      const students = await chatService.loadStudents(sessionId);

      // First, check if a user with this username already exists in this session
      const existingStudentByName = students.find(
        (s) => s.username.toLowerCase() === sanitizedUsername.toLowerCase()
      );

      if (existingStudentByName) {
        // If we found a student with the same name, use their persistent ID
        studentId = existingStudentByName.persistentId;
        console.log(`Using existing ID for ${sanitizedUsername}: ${studentId}`);
      } else if (!studentId) {
        // No existing student with this name and no ID provided - generate a new ID
        studentId = generateStudentId(sanitizedUsername, sessionId);
        console.log(`Generated new ID for ${sanitizedUsername}: ${studentId}`);
      } else {
        // ID was provided - verify it's valid and not used by another username
        const existingStudent = await findStudent(sessionId, studentId);

        if (
          existingStudent &&
          existingStudent.username.toLowerCase() !==
            sanitizedUsername.toLowerCase()
        ) {
          // If the ID exists but with a different username, generate a new ID
          studentId = generateStudentId(sanitizedUsername, sessionId);
          console.log(`Regenerated ID for ${sanitizedUsername}: ${studentId}`);
        }
      }
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
    await ensureSessionExists(sessionId);

    // Load chat history from database if not in cache
    await chatService.loadChatHistory(sessionId);

    // Load students from database if not in cache
    await chatService.loadStudents(sessionId);

    // If this is a teacher, store their socket ID
    if (userRole === "teacher") {
      chatService.setTeacherSocketId(sessionId, socket.id);

      // Send the current student list to the teacher
      socket.emit("student_list", chatService.getStudentsFromCache(sessionId));
    } else {
      // If this is a student, check if they already exist using persistent ID
      const existingStudent = chatService.findStudentInCache(
        sessionId,
        studentId
      );

      if (existingStudent) {
        // Update existing student info but preserve the persistent ID
        const updatedStudent = {
          id: socket.id,
          persistentId: studentId,
          username: sanitizedUsername,
          status: "online",
          lastActive: new Date().toISOString(),
          sessionId: sessionId,
        };

        chatService.updateStudentInCache(sessionId, updatedStudent);

        // Update in database
        await saveStudent(updatedStudent);

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

        chatService.updateStudentInCache(sessionId, studentInfo);

        // Save to database
        await saveStudent(studentInfo);

        console.log(
          `New student ${sanitizedUsername} joined room ${sessionId} with ID ${studentId}`
        );
      }

      // Notify teacher about new/updated student
      const teacherSocketId = chatService.getTeacherSocketId(sessionId);
      if (teacherSocketId) {
        io.to(teacherSocketId).emit(
          "student_list",
          chatService.getStudentsFromCache(sessionId)
        );
      }
    }

    // Notify about user joining
    const joinMessage = {
      id: generateUniqueMessageId(),
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

    // Add to cache
    chatService.addMessageToCache(joinMessage);

    // Only send the message to the teacher and the joining user
    const teacherSocketId = chatService.getTeacherSocketId(sessionId);
    if (teacherSocketId) {
      io.to(teacherSocketId).emit("message", joinMessage);
    }

    socket.emit("message", joinMessage);

    // Send appropriate chat history
    if (userRole === "student") {
      // For students, filter messages to only show messages relevant to them
      const relevantMessages = await getStudentRelevantMessages(
        sessionId,
        studentId
      );
      socket.emit("chat_history", relevantMessages);
    } else if (userRole === "teacher") {
      // Teachers see all messages
      const allMessages = await chatService.loadChatHistory(sessionId);
      socket.emit("chat_history", allMessages);
    }
  } catch (error) {
    console.error("Error joining room:", error);
    socket.emit("error", { message: "Failed to join room" });
  }
}

// Handle sending messages
async function handleSendMessage(socket, messageData) {
  try {
    console.log("Received send_message:", JSON.stringify(messageData, null, 2));

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
    const senderInfo = {
      senderId: senderId,
      username: socket.userData?.username || "Anonymous",
      role: userRole,
    };

    const formattedMessage = formatMessage(messageData, sessionId, senderInfo);

    console.log("Saving message to database:", {
      id: formattedMessage.id,
      sessionId: formattedMessage.sessionId,
      sender: formattedMessage.sender,
      senderName: formattedMessage.senderName,
      type: formattedMessage.type,
      role: formattedMessage.role,
      recipient: formattedMessage.recipient,
    });

    // Save to database
    await saveMessage(formattedMessage);

    // Add to cache
    chatService.addMessageToCache(formattedMessage);

    // Special handling for AI messages
    if (
      formattedMessage.role === "ai" ||
      formattedMessage.sender === "ai-assistant"
    ) {
      console.log(
        "Processing AI message:",
        formattedMessage.text.substring(0, 50)
      );

      // Send to teacher
      const teacherSocketId = chatService.getTeacherSocketId(sessionId);
      if (teacherSocketId) {
        io.to(teacherSocketId).emit("message", formattedMessage);
      }

      // Send to student recipient
      if (formattedMessage.recipient) {
        const student = chatService.findStudentInCache(
          sessionId,
          formattedMessage.recipient
        );
        if (student) {
          io.to(student.id).emit("message", formattedMessage);
        }
      }
    }
    // If sender is teacher, send only to the specific student
    else if (userRole === "teacher" && recipient) {
      // Find student's current socket ID using their persistent ID
      const student = chatService.findStudentInCache(sessionId, recipient);
      if (student) {
        io.to(student.id).emit("message", {
          ...formattedMessage,
          sender: "teacher",
        });
      }
      socket.emit("message", formattedMessage);
    }
    // If sender is student, send to teacher and back to student
    else if (userRole === "student") {
      // Send to teacher
      const teacherSocketId = chatService.getTeacherSocketId(sessionId);
      if (teacherSocketId) {
        io.to(teacherSocketId).emit("message", formattedMessage);
      }

      // Send back to student (if needed - they might already have added it locally)
      socket.emit("message", {
        ...formattedMessage,
        sender: socket.userData.username,
      });
    }

    // Update student's last activity time if this is a student message
    if (userRole === "student") {
      const student = chatService.findStudentInCache(
        sessionId,
        studentId || null,
        studentId ? null : socket.id
      );

      if (student) {
        const updatedStudent = {
          ...student,
          lastActive: new Date().toISOString(),
          status: "active",
        };

        chatService.updateStudentInCache(sessionId, updatedStudent);

        // Update in database
        await saveStudent(updatedStudent);

        // Notify teacher about updated student status
        const teacherSocketId = chatService.getTeacherSocketId(sessionId);
        if (teacherSocketId) {
          io.to(teacherSocketId).emit(
            "student_list",
            chatService.getStudentsFromCache(sessionId)
          );
        }
      }
    }
  } catch (error) {
    console.error("Error handling message:", error);
    socket.emit("error", { message: "Failed to process message" });
  }
}

// Handle typing status
function handleTypingStatus(socket, data) {
  const { sessionId, username, isTyping, recipient, studentId } = data;
  const userRole = socket.userData?.role || "student";

  // If student is typing, only notify teacher
  if (userRole === "student") {
    const teacherSocketId = chatService.getTeacherSocketId(sessionId);
    if (teacherSocketId) {
      // Use persistent ID if available, otherwise use socket ID
      const typingStudentId = studentId || socket.id;
      io.to(teacherSocketId).emit("user_typing", {
        username,
        isTyping,
        studentId: typingStudentId,
      });
    }
  }
  // If teacher is typing, notify specific student
  else if (userRole === "teacher" && recipient) {
    // Find student's current socket ID using their persistent ID
    const student = chatService.findStudentInCache(sessionId, recipient);
    if (student) {
      io.to(student.id).emit("user_typing", { username, isTyping });
    }
  }
}

// Handle selecting a student to chat with (teacher only)
async function handleSelectStudent(socket, sessionId, studentId) {
  try {
    console.log(
      `Starting select_student for session: ${sessionId}, studentId: ${studentId}`
    );

    const userRole = socket.userData?.role;

    if (userRole !== "teacher") {
      socket.emit("error", { message: "Only teachers can select students" });
      return;
    }

    // Find student using either persistent ID or socket ID
    const student = chatService.findStudentInCache(
      sessionId,
      studentId,
      studentId
    );

    if (!student) {
      socket.emit("error", { message: "Student not found" });
      return;
    }

    const effectiveStudentId = student.persistentId || student.id;

    console.log(
      `Teacher selected student: ${student.username} with ID: ${effectiveStudentId}`
    );

    // Get student-specific chat history
    const studentChat = await getStudentMessages(
      sessionId,
      effectiveStudentId,
      student.username
    );

    console.log(
      `Found ${studentChat.length} relevant messages for student ${student.username}`
    );

    // Send chat history to teacher
    socket.emit("student_chat_history", { studentId, chat: studentChat });
  } catch (error) {
    console.error("Error selecting student:", error);
    socket.emit("error", { message: "Failed to select student" });
  }
}

// Handle kicking a student from the session
async function handleKickStudent(socket, data) {
  try {
    const { sessionId, studentId, persistentId } = data;
    const userRole = socket.userData?.role;

    // Only teachers can kick students
    if (userRole !== "teacher") {
      socket.emit("error", { message: "Only teachers can remove students" });
      return;
    }

    // Find the student using either socket ID or persistent ID
    const studentToKick = chatService.findStudentInCache(
      sessionId,
      persistentId || null,
      persistentId ? null : studentId
    );

    if (!studentToKick) {
      socket.emit("student_kicked", {
        studentId,
        success: false,
        message: "Student not found",
      });
      return;
    }

    // Create a kick message to notify everyone
    const kickMessage = {
      id: generateUniqueMessageId(),
      sessionId: sessionId,
      sender: "system",
      senderName: "System",
      text: `${studentToKick.username} has been removed from the session`,
      timestamp: new Date().toISOString(),
      type: "notification",
      role: "system",
    };

    // Save to database
    await saveMessage(kickMessage);

    // Add to cache
    chatService.addMessageToCache(kickMessage);

    // Notify the student being kicked
    io.to(studentToKick.id).emit("kicked_from_session", {
      message: "You have been removed from this session by the teacher",
    });

    // Disconnect the student's socket
    const studentSocket = io.sockets.sockets.get(studentToKick.id);
    if (studentSocket) {
      studentSocket.disconnect(true);
    }

    // Remove student from database
    await removeStudent(studentToKick.persistentId, studentToKick.id);

    // Remove student from cache
    chatService.removeStudentFromCache(
      sessionId,
      studentToKick.persistentId,
      studentToKick.id
    );

    // Notify teacher about successful kick and updated student list
    socket.emit("student_kicked", { studentId, success: true });
    socket.emit("student_list", chatService.getStudentsFromCache(sessionId));

    // Also send the kick notification message to the teacher
    socket.emit("message", kickMessage);

    console.log(
      `Student ${studentToKick.username} kicked from session ${sessionId}`
    );
  } catch (error) {
    console.error("Error kicking student:", error);
    socket.emit("student_kicked", {
      studentId,
      success: false,
      message: "Failed to kick student",
    });
  }
}

// Handle user leaving
async function handleLeaveRoom(socket, sessionId, username, studentId = null) {
  try {
    const userRole = socket.userData?.role || "student";

    // Notify about user leaving
    const leaveMessage = {
      id: generateUniqueMessageId(),
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

    // Add to cache
    chatService.addMessageToCache(leaveMessage);

    // If teacher left, notify all students
    if (userRole === "teacher") {
      io.to(sessionId).emit("message", leaveMessage);
      chatService.removeTeacherSocketId(sessionId);
    }
    // If student left, notify only teacher and update student list
    else {
      const teacherSocketId = chatService.getTeacherSocketId(sessionId);
      if (teacherSocketId) {
        io.to(teacherSocketId).emit("message", leaveMessage);

        // Update student status
        let studentToUpdate;

        if (studentId) {
          studentToUpdate = chatService.findStudentInCache(
            sessionId,
            studentId
          );
        } else {
          studentToUpdate = chatService.findStudentInCache(
            sessionId,
            null,
            socket.id
          );
        }

        if (studentToUpdate) {
          const updatedStudent = {
            ...studentToUpdate,
            status: "offline",
            lastActive: new Date().toISOString(),
          };

          // Update in database
          await saveStudent(updatedStudent);

          // Remove from cache
          chatService.removeStudentFromCache(
            sessionId,
            studentId || studentToUpdate.persistentId,
            studentId ? null : socket.id
          );

          // Notify teacher about updated student list
          io.to(teacherSocketId).emit(
            "student_list",
            chatService.getStudentsFromCache(sessionId)
          );
        }
      }
    }

    socket.leave(sessionId);
    console.log(`${username} left room: ${sessionId}`);
  } catch (error) {
    console.error("Error leaving room:", error);
    socket.emit("error", { message: "Failed to leave room" });
  }
}

// Handle disconnection
async function handleDisconnect(socket) {
  try {
    const userData = socket.userData;

    if (userData && userData.currentRoom) {
      const sessionId = userData.currentRoom;

      // If this was a teacher, remove them from the room teachers map
      if (
        userData.role === "teacher" &&
        chatService.getTeacherSocketId(sessionId) === socket.id
      ) {
        chatService.removeTeacherSocketId(sessionId);
      }
      // If this was a student, update their status
      else if (userData.role === "student") {
        // Try to find student by persistent ID first, then by socket ID
        const student = chatService.findStudentInCache(
          sessionId,
          userData.persistentId || null,
          userData.persistentId ? null : socket.id
        );

        if (student) {
          const updatedStudent = {
            ...student,
            status: "offline",
            lastActive: new Date().toISOString(),
          };

          // Update in database
          await saveStudent(updatedStudent);

          // Update in cache
          chatService.updateStudentInCache(sessionId, updatedStudent);

          // Notify teacher about updated student status
          const teacherSocketId = chatService.getTeacherSocketId(sessionId);
          if (teacherSocketId) {
            io.to(teacherSocketId).emit(
              "student_list",
              chatService.getStudentsFromCache(sessionId)
            );
          }
        }
      }

      // Add disconnect message
      const disconnectMessage = {
        id: generateUniqueMessageId(),
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

      // Add to cache
      chatService.addMessageToCache(disconnectMessage);

      // Notify appropriate users
      if (userData.role === "teacher") {
        io.to(userData.currentRoom).emit("message", disconnectMessage);
      } else {
        const teacherSocketId = chatService.getTeacherSocketId(
          userData.currentRoom
        );
        if (teacherSocketId) {
          io.to(teacherSocketId).emit("message", disconnectMessage);
        }
      }
    }

    console.log("Client disconnected:", socket.id);
  } catch (error) {
    console.error("Error handling disconnect:", error);
  }
}
