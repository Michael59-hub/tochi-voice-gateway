import express from 'express';
import { adminRouter } from './routes/admin';

export const adminApp = express();
adminApp.use(express.json());

adminApp.use('/v1/admin', adminRouter);