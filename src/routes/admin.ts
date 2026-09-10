import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth';
import { setVoiceDisabled } from '../middleware/quota';

export const adminRouter = Router();

adminRouter.post('/voice/disable', requireAdminAuth, (_req, res) => {
  setVoiceDisabled(true);
  return res.status(200).json({ status: 'VOICE_DISABLED' });
});

adminRouter.post('/voice/enable', requireAdminAuth, (_req, res) => {
  setVoiceDisabled(false);
  return res.status(200).json({ status: 'VOICE_ENABLED' });
});