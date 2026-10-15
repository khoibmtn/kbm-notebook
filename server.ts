import "./src/server/load-env";
import { createServer } from "node:http";
import next from "next";
import { attachSocketServer } from "./src/server/realtime/socket";
import { registerBuiltinHandlers } from "./src/server/jobs/handlers";
import { registerIngestHandler } from "./src/server/jobs/handlers/ingest";
import { startWorker } from "./src/server/jobs/worker";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME_BIND || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

async function main() {
  const httpServer = createServer();
  const app = next({ dev, hostname: "localhost", port, httpServer });
  await app.prepare();
  const handle = app.getRequestHandler();
  httpServer.on("request", (req, res) => {
    void handle(req, res);
  });

  attachSocketServer(httpServer);
  registerBuiltinHandlers();
  registerIngestHandler();
  const worker = startWorker();

  httpServer.listen(port, hostname, () => {
    console.log(`> KBM Notebook sẵn sàng tại http://localhost:${port} (${dev ? "dev" : "production"})`);
  });

  const shutdown = async () => {
    await worker.stop();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
