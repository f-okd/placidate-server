import { Request, Response } from 'express';
import { supabase } from '.';

export const deleteAccount = async (req: Request, res: Response) => {
  console.log('Delete endpoint hit');
  const { userId } = req.params;

  if (!userId) {
    res.status(400).json({ error: 'Invalid user ID' });
    return;
  }

  const success = await deleteAcc(userId);

  if (!success) {
    res.status(500).json({ error: 'Failed to delete account' });
    return;
  }

  res.json({ success: true });
};

const deleteAcc = async (userId: string): Promise<boolean> => {
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
