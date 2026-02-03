/**
 * ServerStatus - Displays server and session status at top of right pane.
 */

import React from "react";
import { Box, Text } from "ink";
import type { MockSession } from "../types.js";
import type { ClientInfo } from "../server.js";

interface ServerStatusProps {
  running: boolean;
  port: number;
  clients: ClientInfo[];
  currentSession: MockSession | null;
}

export function ServerStatus({
  running,
  port,
  clients,
  currentSession,
}: ServerStatusProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box>
        <Text bold>Server: </Text>
        {running ? (
          <>
            <Text color="green">Running</Text>
            <Text dimColor> on port {port}</Text>
          </>
        ) : (
          <Text color="red">Stopped</Text>
        )}
      </Box>

      <Box>
        <Text bold>Session: </Text>
        {currentSession ? (
          <>
            <Text color="cyan">
              {currentSession.name ?? currentSession.id.slice(0, 8)}
            </Text>
            <Text dimColor> ({currentSession.open ? "open" : "closed"})</Text>
          </>
        ) : (
          <Text dimColor>None</Text>
        )}
      </Box>

      <Box>
        <Text bold>Clients: </Text>
        {clients.length === 0 ? (
          <Text dimColor>None connected</Text>
        ) : (
          <Text>
            {clients.map((c, i) => (
              <Text key={c.socketId}>
                {i > 0 && <Text dimColor> | </Text>}
                <Text color="yellow">
                  {c.deviceId ?? c.socketId.slice(0, 6)}
                </Text>
              </Text>
            ))}
          </Text>
        )}
      </Box>
    </Box>
  );
}
