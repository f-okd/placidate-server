import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { getRecommendedPosts } from './recommendation';
import { deleteAccount } from './deleteAccount';
import { authenticateToken } from './authenticate';

const supabaseUrl = String(process.env.SUPABASE_URL);
const serviceKey = String(process.env.SERVICE_KEY);

export const supabase = createClient(supabaseUrl, serviceKey);

const RateLimit = require('express-rate-limit');
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000,
  max: 25,
});

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('tiny'));
app.use(limiter);

const port = 8000;

app.get('/api/health', (req, res) => {
  console.log('Health check endpoint hit');
  res.json({ status: 'ok' });
});

app.delete('/api/users/:userId', authenticateToken, deleteAccount);
app.get('/api/recommendations/:userId', getRecommendedPosts);

app.listen(port, () => {
  console.log(`Placidate listening on port ${port}`);
});
