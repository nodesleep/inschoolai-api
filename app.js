import express from "express";
import cors from "cors";
import routes from "./routes/index.js";

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Apply routes
app.use("/", routes);

// Global error handler for Express routes
app.use((err, req, res, next) => {
  console.error("Express error:", err.stack);
  res.status(500).json({
    error: "Something went wrong on the server",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

export default app;
