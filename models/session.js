import { getDb } from "../config/db.js";

// Create a new session with a random 5-digit code
export async function createSession() {
  const db = getDb();

  // Create a 5-digit numerical code
  let sessionId = "";
  const digits = "0123456789";

  for (let i = 0; i < 5; i++) {
    sessionId += digits.charAt(Math.floor(Math.random() * digits.length));
  }

  // Initialize session in database with active status
  await db.run("INSERT INTO sessions (session_id, status) VALUES (?, ?)", [
    sessionId,
    "active",
  ]);

  return sessionId;
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
