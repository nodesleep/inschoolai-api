// server.js - Entry point for the application
import { createServer } from "http";
import app from "./app.js";
import { initializeDatabase } from "./config/db.js";
import { setupSocketServer } from "./services/socket.js";

// Start the server
const PORT = process.env.PORT || 3000;

// Initialize database and start server
(async () => {
  try {
    // Initialize the database
    await initializeDatabase();

    // Create HTTP server
    const server = createServer(app);

    // Setup Socket.IO
    setupSocketServer(server);

    // Start listening
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();
