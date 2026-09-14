import { app } from './app';
import { adminApp } from './adminApp';

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const adminPort = process.env.ADMIN_PORT ? Number(process.env.ADMIN_PORT) : 4000;

app.listen(port, () => {
  console.log(`Voice Gateway listening on port ${port}`);
});

// Bound to loopback only — not reachable from outside the host/container
// network unless something explicitly proxies to it. Combined with the
// shared-secret check, this means an attacker needs both network access
// and the secret, not just one or the other.
adminApp.listen(adminPort, '127.0.0.1', () => {
  console.log(`Admin API listening on 127.0.0.1:${adminPort}`);
});