import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.log('hey');
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  console.log(`token: ${token}`);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  jwt.verify(token, SUPABASE_JWT_SECRET, (err: any, decoded: any) => {
    if (err) {
      return res.status(403).json({ error: 'Forbidden - Invalid token' });
    }

    if (decoded.sub !== req.params.userId) {
      return res
        .status(403)
        .json({ error: 'Forbidden - Not authorized to delete this account' });
    }

    req.body.user = decoded.sub;
    next();
  });
};
