import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { updateDeviceOnline, upsertDeviceStatus } from "./db.js";

type SocketContext = {
  socketId: string;
  userId: string;
  deviceId: string;
};

const userSockets = new Map<string, Map<string, WebSocket>>();

export function setupRealtimeServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/v1/realtime" });

  wss.on("connection", (socket, request) => {
    const requestUrl = new URL(request.url ?? "", "http://localhost");
    const userId = requestUrl.searchParams.get("userId") ?? "";
    const deviceId = requestUrl.searchParams.get("deviceId") ?? "";
    const deviceType = requestUrl.searchParams.get("deviceType") ?? "desktop";

    if (!userId || !deviceId) {
      socket.close(1008, "userId and deviceId are required");
      return;
    }

    const socketId = randomUUID();
    const ctx: SocketContext = { socketId, userId, deviceId };

    let sockets = userSockets.get(userId);
    if (!sockets) {
      sockets = new Map<string, WebSocket>();
      userSockets.set(userId, sockets);
    }

    sockets.set(socketId, socket);
    const now = new Date().toISOString();
    upsertDeviceStatus.run(deviceId, userId, deviceType, 1, now, now);

    socket.on("close", () => {
      const activeSockets = userSockets.get(ctx.userId);
      activeSockets?.delete(ctx.socketId);
      if (activeSockets && activeSockets.size === 0) {
        userSockets.delete(ctx.userId);
      }
      updateDeviceOnline.run(0, new Date().toISOString(), ctx.deviceId);
    });
  });

  return {
    notifyUser(userId: string, payload: unknown) {
      const sockets = userSockets.get(userId);
      if (!sockets) return;
      const message = JSON.stringify(payload);
      for (const socket of sockets.values()) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    }
  };
}
