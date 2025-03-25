import { v4 as uuidv4 } from "uuid";

// Helper function to generate a consistent student ID with added randomness
export function generateStudentId(username, sessionId) {
  // Generate a truly unique ID by combining session, username, and a unique random string
  return `${sessionId}_${username.toLowerCase().trim()}_${uuidv4().substring(
    0,
    8
  )}`;
}

// Helper function to generate a unique message ID
export function generateUniqueMessageId() {
  return `${Date.now()}_${uuidv4().substring(0, 8)}`;
}

// Format a message for consistent structure
export function formatMessage(messageData, sessionId, senderInfo) {
  const { message, recipient } = messageData;

  return {
    id: message.id || generateUniqueMessageId(),
    sessionId: sessionId,
    sender: senderInfo.senderId,
    senderName: message.sender || senderInfo.username || "Anonymous",
    text:
      typeof message.text === "string"
        ? message.text
        : String(message.text || ""),
    timestamp: message.timestamp || new Date().toISOString(),
    type: message.type || "message",
    role: message.role || senderInfo.role,
    recipient: recipient || null,
  };
}
