import express from 'express';
import { installationsRouter } from './routes/installations';
import { voiceRouter } from './routes/voice';

export const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use('/v1/installations', installationsRouter);
app.use('/v1/voice', voiceRouter);