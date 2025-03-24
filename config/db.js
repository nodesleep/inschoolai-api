import sqlite3 from "sqlite3";
import { open } from "sqlite";

// Database instance
let db;

// Initialize the database
export async function initializeDatabase() {
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
  return db;
}

// Export the database instance getter
export function getDb() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}
