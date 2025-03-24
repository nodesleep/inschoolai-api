import { getDb } from "../config/db.js";

// Save or update a student
export async function saveStudent(student) {
  const db = getDb();

  try {
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

    return true;
  } catch (error) {
    console.error("Error saving student:", error);
    return false;
  }
}

// Get all students for a session
export async function getSessionStudents(sessionId) {
  const db = getDb();

  try {
    const dbStudents = await db.all(
      "SELECT * FROM students WHERE session_id = ?",
      [sessionId]
    );

    // Format for frontend consistency
    return dbStudents.map((student) => ({
      id: student.socket_id,
      persistentId: student.persistent_id,
      username: student.username,
      status: student.status,
      lastActive: student.last_active,
      sessionId: student.session_id,
    }));
  } catch (error) {
    console.error("Error getting students:", error);
    return [];
  }
}

// Find student by persistent ID or socket ID
export async function findStudent(sessionId, studentId, socketId = null) {
  const db = getDb();

  try {
    let student;

    if (studentId) {
      student = await db.get(
        "SELECT * FROM students WHERE session_id = ? AND persistent_id = ?",
        [sessionId, studentId]
      );
    } else if (socketId) {
      student = await db.get(
        "SELECT * FROM students WHERE session_id = ? AND socket_id = ?",
        [sessionId, socketId]
      );
    }

    if (student) {
      return {
        id: student.socket_id,
        persistentId: student.persistent_id,
        username: student.username,
        status: student.status,
        lastActive: student.last_active,
        sessionId: student.session_id,
      };
    }

    return null;
  } catch (error) {
    console.error("Error finding student:", error);
    return null;
  }
}

// Remove a student from the database
export async function removeStudent(studentId, socketId = null) {
  const db = getDb();

  try {
    if (studentId) {
      await db.run("DELETE FROM students WHERE persistent_id = ?", [studentId]);
    } else if (socketId) {
      await db.run("DELETE FROM students WHERE socket_id = ?", [socketId]);
    }

    return true;
  } catch (error) {
    console.error("Error removing student:", error);
    return false;
  }
}
