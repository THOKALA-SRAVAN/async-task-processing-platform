import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { taskController } from '../controllers/task.controller';
import { config } from '../../config';

const router = Router();

const createLimiter = rateLimit({
  windowMs:       config.rateLimit.windowMs,
  max:            config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: { message: 'Too many requests, please try again later' } },
});

router.post('/',    createLimiter,        taskController.create);
router.get('/:id',                        taskController.getById);
router.get('/',                           taskController.list);

export default router;
