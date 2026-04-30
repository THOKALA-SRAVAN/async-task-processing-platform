import { randomUUID } from 'crypto';
import express from 'express';
import taskRoutes from './api/routes/task.routes';
import { errorMiddleware } from './api/middlewares/error.middleware';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

const app = express();

app.use(express.json());

app.use((req, _res, next) => {
  req.correlationId = randomUUID();
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use('/api/tasks', taskRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: { message: 'Route not found' } });
});

app.use(errorMiddleware);

export default app;
