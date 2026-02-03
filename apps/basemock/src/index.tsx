#!/usr/bin/env node
/**
 * BaseMock TUI - Mock Base server for testing Socket.IO integration.
 * Built with Ink (React for terminal).
 */

import { render } from "ink";
import { App } from "./App.js";

// Use alternate screen buffer to prevent artifacts
process.stdout.write("\x1b[?1049h"); // Enter alternate screen
process.stdout.write("\x1b[2J"); // Clear screen
process.stdout.write("\x1b[H"); // Move cursor to top-left

const { waitUntilExit } = render(<App />);

waitUntilExit().then(() => {
  process.stdout.write("\x1b[?1049l"); // Exit alternate screen
  console.log("Goodbye!");
  process.exit(0);
});

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  process.stdout.write("\x1b[?1049l"); // Exit alternate screen
  process.exit(0);
});
