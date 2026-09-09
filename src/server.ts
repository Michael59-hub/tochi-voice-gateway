import { app } from './app';

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(port, () => {
  console.log(`Voice Gateway listening on port ${port}`);
});