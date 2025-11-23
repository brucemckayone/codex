// Define shared types for the access package here

export type AccessSubject = {
  id: string;
  type: 'user' | 'role';
};

/**
 * User library item with content, purchase, and progress information
 */
export interface UserLibraryItem {
  content: {
    id: string;
    title: string;
    description: string;
    thumbnailUrl: string | null;
    contentType: string;
    durationSeconds: number;
  };
  purchase: {
    purchasedAt: string; // ISO 8601 timestamp
    priceCents: number;
  };
  progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    percentComplete: number;
    updatedAt: string; // ISO 8601 timestamp
  } | null;
}

/**
 * User library response with pagination
 */
export interface UserLibraryResponse {
  items: UserLibraryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
