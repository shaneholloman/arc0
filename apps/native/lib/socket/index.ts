/**
 * Socket.IO module for real-time communication with Base service.
 */

export * from './types';
export * from './manager';
export * from './actions';
export {
  SocketProvider,
  useSocketContext,
  useConnectionStatus,
  useConnectionState,
  useActiveWorkstationId,
  useBackgroundConnectedCount,
} from './provider';
