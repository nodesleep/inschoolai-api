import { getDb } from "../config/db.js";

// Create a new session with a random 5-digit code
export async function createSession(teacherId = null) {
  const db = getDb();

  // Create a 5-digit numerical code
  let sessionId;
  let isUnique = false;

  // Keep trying until we get a unique session ID
  while (!isUnique) {
    sessionId = generateRandomSessionId();

    // Check if this session ID already exists
    const existingSession = await db.get(
      "SELECT session_id FROM sessions WHERE session_id = ?",
      [sessionId]
    );

    if (!existingSession) {
      isUnique = true;
    }
  }

  // Initialize session in database with active status and teacher ID
  await db.run(
    "INSERT INTO sessions (session_id, status, teacher_id) VALUES (?, ?, ?)",
    [sessionId, "active", teacherId]
  );

  console.log(
    `Created new session: ${sessionId} for teacher: ${teacherId || "anonymous"}`
  );
  return sessionId;
}

// Helper function to generate a random session ID
function generateRandomSessionId() {
  // Generate a random 5-digit number
  const min = 10000; // Smallest 5-digit number
  const max = 99999; // Largest 5-digit number

  // Math.random() gives a number between 0 and 1
  // We scale and shift it to get a number between min and max, then round down
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

// Get a session by ID
export async function getSession(sessionId) {
  const db = getDb();
  return await db.get("SELECT * FROM sessions WHERE session_id = ?", [
    sessionId,
  ]);
}

// Check if a session exists and is active
export async function isSessionActive(sessionId) {
  const db = getDb();
  const session = await db.get(
    "SELECT * FROM sessions WHERE session_id = ? AND status = 'active'",
    [sessionId]
  );
  return session !== undefined;
}

// Check if a session exists, create it if it doesn't (only for back-compatibility)
export async function ensureSessionExists(sessionId) {
  const db = getDb();
  const session = await getSession(sessionId);

  if (!session) {
    await db.run("INSERT INTO sessions (session_id, status) VALUES (?, ?)", [
      sessionId,
      "active",
    ]);
    return false; // Session was created
  }

  return true; // Session already existed
}

// End/deactivate a session
export async function deactivateSession(sessionId) {
  const db = getDb();
  await db.run("UPDATE sessions SET status = 'inactive' WHERE session_id = ?", [
    sessionId,
  ]);
  return true;
}

// Get all sessions for a specific teacher
export async function getTeacherSessions(teacherId) {
  const db = getDb();

  try {
    const sessions = await db.all(
      "SELECT * FROM sessions WHERE teacher_id = ? ORDER BY created_at DESC",
      [teacherId]
    );

    return sessions;
  } catch (error) {
    console.error("Error getting teacher sessions:", error);
    return [];
  }
}

// Check if a teacher owns a specific session
export async function isTeacherSessionOwner(sessionId, teacherId) {
  const db = getDb();

  try {
    const session = await db.get(
      "SELECT * FROM sessions WHERE session_id = ? AND teacher_id = ?",
      [sessionId, teacherId]
    );

    return session !== undefined;
  } catch (error) {
    console.error("Error checking session ownership:", error);
    return false;
  }
}
