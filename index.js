import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import ServerlessHttp from 'serverless-http';
import rateLimit from 'express-rate-limit';

import { authenticateToken } from './authenticate.js';
import { deleteAccount } from './deleteAccount.js';
import { getRecommendedPosts } from './recommendation.js';

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 25,
});

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('tiny'));
app.use(limiter);

// const port = 8000;

app.get('/api/health', (req, res) => {
  console.log('Health check endpoint hit');
  res.json({ status: 'ok' });
});

app.delete('/api/users/:userId', authenticateToken, deleteAccount);
app.get('/api/recommendations/:userId', getRecommendedPosts);

// app.listen(port, () => {
//   console.log(`Placidate listening on port ${port}`);
// });

export const handler = ServerlessHttp(app);
