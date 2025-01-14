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
  console.log(`Example app listening on port ${port}`);
});

export const deleteAccount = async (userId: string): Promise<boolean> => {
  try {
    // Get all user's post IDs
    const { data: posts, error: postFetchError } = await supabase
      .from('posts')
      .select('id')
      .eq('author_id', userId);

    if (postFetchError) {
      console.error('Error fetching user posts:', {
        operation: 'fetch_user_posts',
        error: postFetchError,
        userId,
      });
      return false;
    }

    const postIds = posts?.map((post) => post.id) || [];

    // Delete likes on user's posts AND likes made by the user
    const { error: likesDeleteError } = await supabase
      .from('likes')
      .delete()
      .or(
        `post_id.in.(${postIds
          .map((id) => `"${id}"`)
          .join(',')}),user_id.eq."${userId}"`
      );

    if (likesDeleteError) {
      console.error('Error deleting likes:', {
        operation: 'delete_likes',
        error: likesDeleteError,
        userId,
      });
      return false;
    }

    // Delete bookmarks of user's posts AND bookmarks made by the user
    const { error: bookmarksDeleteError } = await supabase
      .from('bookmarks')
      .delete()
      .or(
        `post_id.in.(${postIds
          .map((id) => `"${id}"`)
          .join(',')}),user_id.eq."${userId}"`
      );

    if (bookmarksDeleteError) {
      console.error('Error deleting bookmarks:', {
        operation: 'delete_bookmarks',
        error: bookmarksDeleteError,
        userId,
      });
      return false;
    }

    // Delete comments on user's posts AND comments made by the user
    const { error: commentsDeleteError } = await supabase
      .from('comments')
      .delete()
      .or(
        `post_id.in.(${postIds
          .map((id) => `"${id}"`)
          .join(',')}),user_id.eq."${userId}"`
      );

    if (commentsDeleteError) {
      console.error('Error deleting comments:', {
        operation: 'delete_comments',
        error: commentsDeleteError,
        userId,
      });
      return false;
    }

    // Delete post tags
    const { error: tagMappingDeleteError } = await supabase
      .from('post_tags')
      .delete()
      .in('post_id', postIds);

    if (tagMappingDeleteError) {
      console.error('Error deleting user post tag mappings:', {
        operation: 'delete_user_tag_mappings',
        error: tagMappingDeleteError,
        userId,
      });
      return false;
    }

    // Delete posts
    const { error: postsDeleteError } = await supabase
      .from('posts')
      .delete()
      .eq('author_id', userId);

    if (postsDeleteError) {
      console.error('Error deleting user posts:', {
        operation: 'delete_user_posts',
        error: postsDeleteError,
        userId,
      });
      return false;
    }

    // Delete blocks where user is either blocker or blocked
    const { error: blocksDeleteError } = await supabase
      .from('blocks')
      .delete()
      .or(`blocker_id.eq."${userId}",blocked_id.eq."${userId}"`);

    if (blocksDeleteError) {
      console.error('Error deleting blocks:', {
        operation: 'delete_blocks',
        error: blocksDeleteError,
        userId,
      });
      return false;
    }

    // Delete all follow relationships where user is either follower or following
    const { error: followsDeleteError } = await supabase
      .from('follows')
      .delete()
      .or(`follower_id.eq."${userId}",following_id.eq."${userId}"`);

    if (followsDeleteError) {
      console.error('Error deleting follows:', {
        operation: 'delete_follows',
        error: followsDeleteError,
        userId,
      });
      return false;
    }

    // Delete user profile
    const { error: profileDeleteError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (profileDeleteError) {
      console.error('Error deleting user profile:', {
        operation: 'delete_user_profile',
        error: profileDeleteError,
        userId,
      });
      return false;
    }

    // Finally delete the user auth record
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
