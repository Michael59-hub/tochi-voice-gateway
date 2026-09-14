import { app } from './app';
import { adminApp } from './adminApp';
import { startScheduledCleanup } from './lib/scheduledCleanup';

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const adminPort = process.env.ADMIN_PORT ? Number(process.env.ADMIN_PORT) : 4000;

app.listen(port, () => {
  console.log(`Voice Gateway listening on port ${port}`);
});

adminApp.listen(adminPort, '127.0.0.1', () => {
  console.log(`Admin API listening on 127.0.0.1:${adminPort}`);
});

startScheduledCleanup();
console.log('Scheduled cleanup job started (hourly)');