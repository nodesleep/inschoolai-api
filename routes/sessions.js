import express from "express";
import {
  createSession,
  isSessionActive,
  deactivateSession,
} from "../models/session.js";
import { getSessionStudents } from "../models/student.js";
import { getSessionMessages, getStudentMessages } from "../models/message.js";

const router = express.Router();

// Generate a new session
router.post("/generate-session", async (req, res) => {
  try {
    // Create a new session ID
    const sessionId = await createSession();

    res.json({ sessionId });
  } catch (error) {
    console.error("Error generating session:", error);
    res.status(500).json({ error: "Failed to generate session" });
  }
});

// Get all students in a session (only available to teachers)
router.get("/session/:sessionId/students", async (req, res, next) => {
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

    // Get students from database
    const students = await getSessionStudents(sessionId);
    res.json(students);
  } catch (error) {
    next(error);
  }
});

// Get chat history for a specific room and student (only available to teachers)
router.get("/session/:sessionId/student/:studentId", async (req, res, next) => {
  try {
    const { sessionId, studentId } = req.params;
    const { role, username } = req.query;

    if (!sessionId || !studentId) {
      return res
        .status(400)
        .json({ error: "Session ID and Student ID are required" });
    }

    // Only teachers can get chat history
    if (role !== "teacher") {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get chat history for specific student from database
    const studentChat = await getStudentMessages(
      sessionId,
      studentId,
      username
    );
    res.json(studentChat);
  } catch (error) {
    next(error);
  }
});

// Add a new endpoint to verify if a session is active (for students to check before attempting to join)
router.get("/session/:sessionId/status", async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    const active = await isSessionActive(sessionId);
    res.json({ sessionId, active });
  } catch (error) {
    next(error);
  }
});

// Add endpoint to end a session (teacher only)
router.post("/session/:sessionId/end", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { role } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    // Only teachers can end a session
    if (role !== "teacher") {
      return res.status(403).json({ error: "Access denied" });
    }

    await deactivateSession(sessionId);
    res.json({ success: true, message: "Session ended successfully" });
  } catch (error) {
    next(error);
  }
});

export default router;
