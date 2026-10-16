import { createApp } from './app.js';

const port = Number(process.env.PORT || 3002);
const { app, manager } = await createApp();
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`PostReady companion → http://localhost:${port}`),
);
const cleanup = setInterval(
  () => {
    void manager
      .cleanup()
      .catch((error) => console.error('Cleanup failed:', error.message));
  },
  10 * 60 * 1000,
);
cleanup.unref();
function shutdown() {
  clearInterval(cleanup);
  manager.shutdown();
  server.close();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
