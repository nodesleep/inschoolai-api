import express from "express";
import sessionRoutes from "./sessions.js";
import studentRoutes from "./students.js";

const router = express.Router();

// Basic routes
router.get("/", (req, res) => {
  res.send("Session server is running");
});

// Mount sub-routes
router.use("/api", sessionRoutes);
router.use("/api", studentRoutes);

export default router;
