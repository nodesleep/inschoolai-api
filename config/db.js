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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active',
      teacher_id TEXT
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

  // Run migrations for existing databases
  await migrateDatabase(db);

  console.log("Database initialized");
  return db;
}

// Handle migrations for existing databases
async function migrateDatabase(db) {
  try {
    // Check if status column exists in sessions table
    const tableInfo = await db.all("PRAGMA table_info(sessions)");

    // Check for status column
    const hasStatusColumn = tableInfo.some(
      (column) => column.name === "status"
    );
    if (!hasStatusColumn) {
      console.log("Migrating database: Adding status column to sessions table");
      await db.exec(
        "ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT 'active'"
      );
      await db.exec("UPDATE sessions SET status = 'active'");
      console.log("Status column migration completed");
    }

    // Check for teacher_id column
    const hasTeacherIdColumn = tableInfo.some(
      (column) => column.name === "teacher_id"
    );
    if (!hasTeacherIdColumn) {
      console.log(
        "Migrating database: Adding teacher_id column to sessions table"
      );
      await db.exec("ALTER TABLE sessions ADD COLUMN teacher_id TEXT");
      console.log("Teacher ID column migration completed");
    }
  } catch (error) {
    console.error("Error during database migration:", error);
    // Don't throw, as we want the app to continue even if migration fails
  }
}

// Export the database instance getter
export function getDb() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}
