import 'dotenv/config';

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import morgan from 'morgan';

const supabaseUrl = String(process.env.SUPABASE_URL);
const serviceKey = String(process.env.SERVICE_KEY);

export const supabase = createClient(supabaseUrl, serviceKey);

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('tiny'));
const port = 8000;

app.get('/api/health', (req, res) => {
  console.log('Health check endpoint hit');
  res.json({ status: 'ok' });
});

app.post('/api/users/:userId/delete', async (req, res) => {
  console.log('Delete endpoint hit');
  const { userId } = req.params;

  if (!userId) {
    res.status(400).json({ error: 'Invalid user ID' });
    return;
  }

  const success = await deleteAccount(userId);

  if (!success) {
    res.status(500).json({ error: 'Failed to delete account' });
    return;
  }

  res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Placidate listening on port ${port}`);
});

export const deleteAccount = async (userId: string): Promise<boolean> => {
  try {
    const { error: userDeleteError } = await supabase.auth.admin.deleteUser(
      userId
    );

    if (userDeleteError) {
      console.error('Error deleting user auth record:', {
        operation: 'delete_user_auth',
        error: userDeleteError,
        userId,
      });
      return false;
    }

    const { data: avatars, error: avatarListError } = await supabase.storage
      .from('avatars')
      .list('', {
        search: `avatar-${userId}-`,
      });

    if (avatarListError) {
      console.error(`Error listing avatars for user ${userId}`);
      return false;
    }
    // Should only ever return one value
    if (avatars && avatars.length > 0) {
      const { error: avatarDeleteError } = await supabase.storage
        .from('avatars')
        .remove([avatars[0].name]);

      if (avatarDeleteError) {
        console.error(`Error deleting user ${userId}'s avatar:`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Unexpected error in deleteAccount:', {
      operation: 'delete_account',
      error,
      userId,
    });
    return false;
  }
};
