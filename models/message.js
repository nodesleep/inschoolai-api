import { getDb } from "../config/db.js";
import { generateUniqueMessageId } from "../utils/helpers.js";

// Save a message to the database
export async function saveMessage(message) {
  const db = getDb();

  // Ensure message has a unique ID
  if (!message.id || message.id.indexOf("_") === -1) {
    message.id = generateUniqueMessageId();
  }

  try {
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
        message.type || "message", // Default to "message" if type is not provided
        message.role || "system", // Default to "system" if role is not provided
        message.recipient || null,
      ]
    );

    return message;
  } catch (error) {
    console.error("Error saving message:", error);
    return null;
  }
}

// Get all messages for a session
export async function getSessionMessages(sessionId) {
  const db = getDb();

  try {
    const messages = await db.all(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
      [sessionId]
    );

    // Format the messages to ensure consistency with frontend
    return messages.map((msg) => ({
      id: msg.id,
      sender: msg.sender,
      senderName: msg.sender_name,
      text: msg.text,
      timestamp: msg.timestamp,
      type: msg.type,
      role: msg.role,
      recipient: msg.recipient,
    }));
  } catch (error) {
    console.error("Error getting messages:", error);
    return [];
  }
}

// Get messages for a specific student
export async function getStudentMessages(
  sessionId,
  studentId,
  studentUsername
) {
  const db = getDb();

  try {
    const messages = await db.all(
      `SELECT * FROM messages 
       WHERE session_id = ? AND (
         -- Include all system notifications
         type = 'notification' OR
         -- Include messages sent by this student (by ID or username)
         sender = ? OR
         sender_name = ? OR
         -- Include messages where this student is the recipient
         recipient = ? OR
         -- Include AI messages triggered by this student
         (sender = 'ai-assistant' AND recipient = ?)
       )
       ORDER BY timestamp ASC`,
      [sessionId, studentId, studentUsername, studentId, studentId]
    );

    // Format the messages for the frontend
    return messages.map((msg) => ({
      id: msg.id,
      sender: msg.sender,
      senderName: msg.sender_name,
      text: msg.text,
      timestamp: msg.timestamp,
      type: msg.type,
      role: msg.role,
      recipient: msg.recipient,
    }));
  } catch (error) {
    console.error("Error getting student messages:", error);
    return [];
  }
}

// Get student-relevant messages (filtered for privacy)
export async function getStudentRelevantMessages(sessionId, studentId) {
  const db = getDb();

  try {
    const messages = await db.all(
      `SELECT * FROM messages 
       WHERE session_id = ? AND (
         -- Show only global system notifications (not student-specific ones)
         (type = 'notification' AND role = 'system' AND recipient IS NULL) OR
         
         -- Show messages from this specific student
         sender = ? OR
         
         -- Show teacher messages to this student or global announcements
         (role = 'teacher' AND (recipient = ? OR recipient IS NULL)) OR
         
         -- Show AI messages intended for this student
         (sender = 'ai-assistant' AND recipient = ?)
       )
       ORDER BY timestamp ASC`,
      [sessionId, studentId, studentId, studentId]
    );

    // Format the messages for consistency
    return messages.map((msg) => ({
      id: msg.id,
      sender: msg.sender,
      senderName: msg.sender_name,
      text: msg.text,
      timestamp: msg.timestamp,
      type: msg.type,
      role: msg.role,
      recipient: msg.recipient,
    }));
  } catch (error) {
    console.error("Error getting student relevant messages:", error);
    return [];
  }
}
