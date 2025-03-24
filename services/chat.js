import {
  getSessionMessages,
  getStudentRelevantMessages,
} from "../models/message.js";
import { getSessionStudents } from "../models/student.js";

// In-memory cache for better performance
const chatCache = {};
const roomTeachers = {};
const roomStudents = {};

// Load chat history from database
export async function loadChatHistory(sessionId) {
  if (chatCache[sessionId] && chatCache[sessionId].length > 0) {
    return chatCache[sessionId];
  }

  const messages = await getSessionMessages(sessionId);
  chatCache[sessionId] = messages;
  return messages;
}

// Load students from database
export async function loadStudents(sessionId) {
  if (roomStudents[sessionId] && roomStudents[sessionId].length > 0) {
    return roomStudents[sessionId];
  }

  const students = await getSessionStudents(sessionId);
  roomStudents[sessionId] = students;
  return students;
}

// Add message to cache
export function addMessageToCache(message) {
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
    type: message.type || "message",
    role: message.role || "system",
    recipient: message.recipient,
  };

  chatCache[message.sessionId].push(cacheMessage);
  return cacheMessage;
}

// Get teacher socket ID for a session
export function getTeacherSocketId(sessionId) {
  return roomTeachers[sessionId] || null;
}

// Set teacher socket ID for a session
export function setTeacherSocketId(sessionId, socketId) {
  roomTeachers[sessionId] = socketId;
}

// Remove teacher socket ID for a session
export function removeTeacherSocketId(sessionId) {
  delete roomTeachers[sessionId];
}

// Add or update student in cache
export function updateStudentInCache(sessionId, student) {
  if (!roomStudents[sessionId]) {
    roomStudents[sessionId] = [];
  }

  const existingIndex = roomStudents[sessionId].findIndex(
    (s) => s.persistentId === student.persistentId || s.id === student.id
  );

  if (existingIndex >= 0) {
    roomStudents[sessionId][existingIndex] = {
      ...roomStudents[sessionId][existingIndex],
      ...student,
    };
  } else {
    roomStudents[sessionId].push(student);
  }

  return roomStudents[sessionId];
}

// Remove student from cache
export function removeStudentFromCache(sessionId, studentId, socketId = null) {
  if (!roomStudents[sessionId]) {
    return [];
  }

  roomStudents[sessionId] = roomStudents[sessionId].filter(
    (s) =>
      (studentId && s.persistentId !== studentId) ||
      (socketId && s.id !== socketId)
  );

  return roomStudents[sessionId];
}

// Find student in cache
export function findStudentInCache(sessionId, studentId, socketId = null) {
  if (!roomStudents[sessionId]) {
    return null;
  }

  return roomStudents[sessionId].find(
    (s) =>
      (studentId && s.persistentId === studentId) ||
      (socketId && s.id === socketId)
  );
}

// Get all students for a session from cache
export function getStudentsFromCache(sessionId) {
  return roomStudents[sessionId] || [];
}

// Clear cache for a session
export function clearSessionCache(sessionId) {
  delete chatCache[sessionId];
  delete roomStudents[sessionId];
  delete roomTeachers[sessionId];
}
