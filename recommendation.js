import { supabase } from './client.js';

const INTERACTION_WEIGHTS = {
  like: 1.0, // Base weight
  comment: 2.0, // Comments show higher engagement than likes
  bookmark: 3.0, // Bookmarks indicate strong interest for future consumption
};

export const getRecommendedPosts = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`Generating recommendations for user: ${userId}`);

    console.log(`Preprocessing: Fetch and record block relationships`);
    // Get block relationships first
    const { data: blocks, error: blocksError } = await supabase
      .from('blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

    if (blocksError) throw blocksError;

    const blockedUsers = new Set([
      ...blocks
        .filter((block) => block.blocker_id === userId)
        .map((block) => block.blocked_id),
      ...blocks
        .filter((block) => block.blocked_id === userId)
        .map((block) => block.blocker_id),
    ]);

    console.log(`Preprocessing: Fetch mutual follow relationship`);
    // Get users that the current user follows and users that follow the current user
    // for mutual follower privacy check
    const { data: following, error: followingError } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (followingError) throw followingError;

    const { data: followers, error: followersError } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId);

    if (followersError) throw followersError;

    // Create sets for following and followers
    const followingIds = new Set(following?.map((f) => f.following_id) || []);
    const followerIds = new Set(followers?.map((f) => f.follower_id) || []);

    // Find mutual followers (users who the current user follows and who follow the current user)
    const mutualFollowerIds = new Set(
      [...followingIds].filter((id) => followerIds.has(id))
    );

    /************************************************************************************************/
    /**************************** 1. Get user's interaction history     ********************************/
    /************************************************************************************************/
    console.log('Step 1: Fetching interaction history');
    // Fetch posts that user has liked
    const { data: userLikes, error: likesError } = await supabase
      .from('likes')
      .select('post_id, created_at, posts(author_id)')
      .eq('user_id', userId);

    if (likesError) throw likesError;

    // Fetch posts that user has commented on with author information
    const { data: userComments, error: commentsError } = await supabase
      .from('comments')
      .select('post_id, created_at, posts(author_id)')
      .eq('user_id', userId);

    if (commentsError) throw commentsError;

    // Fetch posts that user has bookmarked
    const { data: userBookmarks, error: bookmarksError } = await supabase
      .from('bookmarks')
      .select('post_id, created_at, posts(author_id)')
      .eq('user_id', userId);

    if (bookmarksError) throw bookmarksError;

    // If user has no interactions yet, return popular posts instead
    if (
      (!userLikes || userLikes.length === 0) &&
      (!userComments || userComments.length === 0) &&
      (!userBookmarks || userBookmarks.length === 0)
    ) {
      return res.json(
        await getPopularPosts(userId, blockedUsers, mutualFollowerIds)
      );
    }

    /************************************************************************************************/
    /**************************** 2. Build weighted interaction map     ******************************/
    /************************************************************************************************/
    console.log('Step 2: Weighting past interactions');
    const userInteractions = new Map(); // post_id -> weighted score that is used to weight significance/relevancy of the post
    const userInteractedPosts = new Set(); // Posts the user has interacted with
    const previouslyRecommendedPosts = [];

    // Fetch and exclude previously recommended posts
    const { data: previouslyRecommended, error: prevRecError } = await supabase
      .from('post_recommendations')
      .select('post_id')
      .eq('user_id', userId);

    if (prevRecError) throw prevRecError;

    // Add these to userInteractedPosts set to prevent re-recommendation
    if (previouslyRecommended) {
      previouslyRecommended.forEach((rec) => {
        previouslyRecommendedPosts.push(rec.post_id);
      });
    }

    // Add likes
    if (userLikes) {
      userLikes.forEach((like) => {
        const postId = like.post_id;
        // Always add to interacted posts to prevent re-recommendation
        userInteractedPosts.add(postId);

        // Skip weighting if it's the user's own post
        if (like.posts && like.posts.author_id === userId) return;

        // Multiply weight with recency factor
        // Dynamic weights
        const recencyFactor = getRecencyFactor(like.created_at);
        const score = INTERACTION_WEIGHTS.like * recencyFactor;

        // Increment post's relevancy score (how significant is the interaction with this post)
        userInteractions.set(
          postId,
          (userInteractions.get(postId) || 0) + score
        );
      });
    }

    // Add comments
    if (userComments) {
      userComments.forEach((comment) => {
        const postId = comment.post_id;
        userInteractedPosts.add(postId);

        if (comment.posts && comment.posts.author_id === userId) return;

        const recencyFactor = getRecencyFactor(comment.created_at);
        const score = INTERACTION_WEIGHTS.comment * recencyFactor;

        userInteractions.set(
          postId,
          (userInteractions.get(postId) || 0) + score
        );
      });
    }

    // Add bookmarks
    if (userBookmarks) {
      userBookmarks.forEach((bookmark) => {
        const postId = bookmark.post_id;
        userInteractedPosts.add(postId);

        if (bookmark.posts && bookmark.posts.author_id === userId) return;

        const recencyFactor = getRecencyFactor(bookmark.created_at);
        const score = INTERACTION_WEIGHTS.bookmark * recencyFactor;

        userInteractions.set(
          postId,
          (userInteractions.get(postId) || 0) + score
        );
      });
    }

    /************************************************************************************************/
    /************** 3. Find similar users based on weighted interactions     *************************/
    /************************************************************************************************/
    console.log('Step 3: Determining similar users');
    // Convert the interacted posts to an array
    const interactedPostIds = Array.from(userInteractedPosts);

    /***********************  Get other users who interacted with the same posts that the user has interacted with ************************/
    // Fetch users who have liked posts that you have interacted (like/comment/bookmark) with
    const { data: similarUserInteractions, error: similarUsersError } =
      await supabase
        .from('likes')
        .select('user_id, post_id')
        .in('post_id', interactedPostIds)
        .neq('user_id', userId);

    if (similarUsersError) throw similarUsersError;

    // Fetch users who have commented on posts that you have interacted with
    const { data: similarUserComments, error: similarCommentsError } =
      await supabase
        .from('comments')
        .select('user_id, post_id')
        .in('post_id', interactedPostIds)
        .neq('user_id', userId);

    if (similarCommentsError) throw similarCommentsError;

    // Fetch users who have bookmarked posts that you have interacted with
    const { data: similarUserBookmarks, error: similarBookmarksError } =
      await supabase
        .from('bookmarks')
        .select('user_id, post_id')
        .in('post_id', interactedPostIds)
        .neq('user_id', userId);

    if (similarBookmarksError) throw similarBookmarksError;

    /************************************************************************************************/
    /********************* 4. Calculate user similarity scores     *************************************/
    /************************************************************************************************/
    console.log(`Step 4: Calculating user similarity scores`);
    const userSimilarityScores = new Map(); // user_id -> similarity score
    // Process likes
    if (similarUserInteractions) {
      similarUserInteractions.forEach((interaction) => {
        if (blockedUsers.has(interaction.user_id)) return;

        const postId = interaction.post_id;
        const postWeight = userInteractions.get(postId) || 0;

        // Add weighted similarity (Increment post's similarity score by how significant/relevant that post is X interaction weights )
        userSimilarityScores.set(
          interaction.user_id,
          (userSimilarityScores.get(interaction.user_id) || 0) +
            postWeight * INTERACTION_WEIGHTS.like
        );
      });
    }
    // Process comments
    if (similarUserComments) {
      similarUserComments.forEach((comment) => {
        if (blockedUsers.has(comment.user_id)) return;

        const postId = comment.post_id;
        const postWeight = userInteractions.get(postId) || 0;

        // Add weighted similarity
        userSimilarityScores.set(
          comment.user_id,
          (userSimilarityScores.get(comment.user_id) || 0) +
            postWeight * INTERACTION_WEIGHTS.comment
        );
      });
    }
    // Process bookmarks
    if (similarUserBookmarks) {
      similarUserBookmarks.forEach((bookmark) => {
        if (blockedUsers.has(bookmark.user_id)) return;

        const postId = bookmark.post_id;
        const postWeight = userInteractions.get(postId) || 0;

        // Add weighted similarity
        userSimilarityScores.set(
          bookmark.user_id,
          (userSimilarityScores.get(bookmark.user_id) || 0) +
            postWeight * INTERACTION_WEIGHTS.bookmark
        );
      });
    }
    /************************************************************************************************/
    /********** 5. Get not seen before posts that similar users have interacted with     **************/
    /************************************************************************************************/
    /****** Get top 20 most similar users, then find posts they have interacted (liked/commented/bookmarked) with *******/
    console.log(
      'Step 5: Fetching unseen posts that similar users have interacted with'
    );

    const postsToExclude = [
      ...Array.from(userInteractedPosts),
      ...previouslyRecommendedPosts,
    ];
    const excludePostIdsString = formatPostIdsForQuery(postsToExclude);

    const sortedSimilarUsers = Array.from(userSimilarityScores.entries())
      .sort((a, b) => b[1] - a[1]) // sort on score value not user id
      .slice(0, 20) // Top 20 similar users
      .map((entry) => entry[0]);

    if (sortedSimilarUsers.length === 0) {
      return res.json(
        await getPopularPosts(userId, blockedUsers, mutualFollowerIds)
      );
    }
    console.log(`Generating recommendations for user: ${userId}`);
    console.log(`Check post id is not in:`);
    console.log([
      ...Array.from(userInteractedPosts),
      ...previouslyRecommendedPosts,
    ]);

    // Get posts liked by similar users that current user hasn't interacted with
    const { data: recommendedLikes, error: recLikesError } = await supabase
      .from('likes')
      .select(
        `
        post_id,
        user_id,
        posts!inner(
          *,
          profiles!posts_author_id_fkey(id, username, avatar_url, is_private),
          post_tags(
            tag_id,
            tags(name)
          )
        )
      `
      )
      .in('user_id', sortedSimilarUsers)
      .not('post_id', 'in', excludePostIdsString) // prevent rerecommendation
      .order('created_at', { ascending: false });

    if (recLikesError) throw recLikesError;

    // Get posts commented on by similar users
    const { data: recommendedComments, error: recCommentsError } =
      await supabase
        .from('comments')
        .select(
          `
        post_id,
        user_id,
        posts!inner(
          *,
          profiles!posts_author_id_fkey(id, username, avatar_url, is_private),
          post_tags(
            tag_id,
            tags(name)
          )
        )
      `
        )
        .in('user_id', sortedSimilarUsers)
        .not('post_id', 'in', excludePostIdsString)
        .order('created_at', { ascending: false });

    if (recCommentsError) throw recCommentsError;

    // Get posts bookmarked by similar users
    const { data: recommendedBookmarks, error: recBookmarksError } =
      await supabase
        .from('bookmarks')
        .select(
          `
        post_id,
        user_id,
        posts!inner(
          *,
          profiles!posts_author_id_fkey(id, username, avatar_url, is_private),
          post_tags(
            tag_id,
            tags(name)
          )
        )
      `
        )
        .in('user_id', sortedSimilarUsers)
        .not('post_id', 'in', excludePostIdsString)
        .order('created_at', { ascending: false });

    if (recBookmarksError) throw recBookmarksError;

    /************************************************************************************************/
    /********************* 6. Calculate final recommendation scores     *************************/
    /************************************************************************************************/
    console.log('Step 6: Calculating final recommendation scores');
    const recommendationScores = new Map(); // post_id -> score
    const recommendedPosts = new Map(); // post_id -> post object

    // Process likes
    if (recommendedLikes) {
      recommendedLikes.forEach((rec) => {
        if (
          blockedUsers.has(rec.posts.author_id) ||
          rec.posts.author_id === userId
        ) {
          return;
        }

        // Check privacy settings
        if (
          rec.posts.profiles?.is_private &&
          !mutualFollowerIds.has(rec.posts.author_id)
        ) {
          return; // Skip posts from private profiles without mutual follow
        }

        const postId = rec.post_id;
        const userSimilarity = userSimilarityScores.get(rec.user_id) || 0;
        const score = userSimilarity * INTERACTION_WEIGHTS.like;

        recommendationScores.set(
          postId,
          (recommendationScores.get(postId) || 0) + score
        );
        recommendedPosts.set(postId, rec.posts);
      });
    }

    // Process comments
    if (recommendedComments) {
      recommendedComments.forEach((rec) => {
        if (
          blockedUsers.has(rec.posts.author_id) ||
          rec.posts.author_id === userId
        ) {
          return;
        }

        // Check privacy settings
        if (
          rec.posts.profiles?.is_private &&
          !mutualFollowerIds.has(rec.posts.author_id)
        ) {
          return; // Skip posts from private profiles without mutual follow
        }

        const postId = rec.post_id;
        const userSimilarity = userSimilarityScores.get(rec.user_id) || 0;
        const score = userSimilarity * INTERACTION_WEIGHTS.comment;

        recommendationScores.set(
          postId,
          (recommendationScores.get(postId) || 0) + score
        );
        recommendedPosts.set(postId, rec.posts);
      });
    }

    // Process bookmarks
    if (recommendedBookmarks) {
      recommendedBookmarks.forEach((rec) => {
        if (
          blockedUsers.has(rec.posts.author_id) ||
          rec.posts.author_id === userId
        ) {
          return;
        }

        // Check privacy settings
        if (
          rec.posts.profiles?.is_private &&
          !mutualFollowerIds.has(rec.posts.author_id)
        ) {
          return; // Skip posts from private profiles without mutual follow
        }

        const postId = rec.post_id;
        const userSimilarity = userSimilarityScores.get(rec.user_id) || 0;
        const score = userSimilarity * INTERACTION_WEIGHTS.bookmark;

        recommendationScores.set(
          postId,
          (recommendationScores.get(postId) || 0) + score
        );
        recommendedPosts.set(postId, rec.posts);
      });
    }
    /************************************************************************************************/
    /********************* 7. Sort and return recommendations     *************************/
    /************************************************************************************************/
    console.log('Step 7: Sorting and returning final recommendations');
    const sortedRecommendations = Array.from(recommendationScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20) // Top 20 recommendations
      .map((entry) => recommendedPosts.get(entry[0]));

    // Check if we have enough recommendations
    const MIN_RECOMMENDATIONS = 20;
    if (sortedRecommendations.length < MIN_RECOMMENDATIONS) {
      // Need to backfill with popular posts
      const recommendedPostIds = new Set(
        sortedRecommendations.map((post) => post.id)
      );

      // Get popular posts for backfilling
      const popularResults = await getPopularPosts(
        userId,
        blockedUsers,
        mutualFollowerIds
      );
      const popularPosts = popularResults.recommendations;

      // Filter out any that are already in our recommendations
      const filteredPopularPosts = popularPosts.filter(
        (post) => !recommendedPostIds.has(post.id)
      );

      // Add enough popular posts to reach our minimum
      const postsToAdd = filteredPopularPosts.slice(
        0,
        MIN_RECOMMENDATIONS - sortedRecommendations.length
      );
      const finalRecommendations = [...sortedRecommendations, ...postsToAdd];

      // Insert the recommendation records
      const recommendationInserts = finalRecommendations.map((post) => ({
        user_id: userId,
        post_id: post.id,
      }));
      await supabase.from('post_recommendations').insert(recommendationInserts);

      return res.json({
        recommendations: finalRecommendations,
        recommendationCount: finalRecommendations.length,
        backfilled: postsToAdd.length > 0, // Flag to indicate backfilling occurred
        backfilledCount: postsToAdd.length,
      });
    }

    // If we had enough recommendations, return them as-is
    // Insert the recommendation records
    const recommendationInserts = sortedRecommendations.map((post) => ({
      user_id: userId,
      post_id: post.id,
    }));
    await supabase.from('post_recommendations').insert(recommendationInserts);

    return res.json({
      recommendations: sortedRecommendations,
      recommendationCount: sortedRecommendations.length,
      backfilled: false,
    });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return res
      .status(500)
      .json({ error: 'Failed to generate recommendations' });
  }
};

// Helper function to calculate recency factor - more recent interactions get higher weight
function getRecencyFactor(timestamp) {
  const now = new Date();
  const interactionDate = new Date(timestamp);
  const ageInDays = (now - interactionDate) / (1000 * 60 * 60 * 24);

  // Exponential decay - older interactions have less influence
  // After 30 days, interaction weight is halved
  return Math.exp(-0.023 * ageInDays); // ln(2)/30 ≈ 0.023
}

// Updated getPopularPosts function to respect privacy settings
async function getPopularPosts(userId, blockedUsers, mutualFollowerIds) {
  // Get posts with the most interactions (weighted)
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select(
      `
      *,
      profiles!posts_author_id_fkey(id, username, avatar_url, is_private),
      post_tags(tag_id, tags(name)),
      likes(count),
      comments(count),
      bookmarks(count)
    `
    )
    .order('created_at', { ascending: false })
    .limit(50);

  if (postsError) throw postsError;

  // Filter out posts from blocked users and respect privacy settings
  const filteredPosts = posts.filter((post) => {
    // Skip posts from blocked users
    if (blockedUsers.has(post.author_id) || post.author_id === userId) {
      return false;
    }

    // Check privacy settings
    if (post.profiles?.is_private) {
      return mutualFollowerIds.has(post.author_id);
    }

    // Public profiles' posts are visible to all
    return true;
  });

  // Calculate popularity score for each post
  const scoredPosts = filteredPosts.map((post) => {
    const likesCount = post.likes?.length || 0;
    const commentsCount = post.comments?.length || 0;
    const bookmarksCount = post.bookmarks?.length || 0;

    // Calculate popularity score using the same weights
    const popularityScore =
      likesCount * INTERACTION_WEIGHTS.like +
      commentsCount * INTERACTION_WEIGHTS.comment +
      bookmarksCount * INTERACTION_WEIGHTS.bookmark;

    return {
      post,
      score: popularityScore,
    };
  });

  // Sort by popularity score and return top 20
  const recommendations = scoredPosts
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((item) => item.post);

  return {
    recommendations,
    recommendationCount: recommendations.length,
  };
}

const formatPostIdsForQuery = (postIds) => {
  if (!postIds || postIds.length === 0) {
    return '()';
  }
  return `(${postIds.join(',')})`;
};
