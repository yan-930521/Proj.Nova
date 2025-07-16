import { Logger } from '../../../libs/loggers/Logger';

/**
 * Metadata for a memory item.
 * This includes information such as the type of memory, when it occurred,
 * its source, and other relevant details.
 */
export interface MemoryMetadata {
  /** The ID of the user associated with the memory. Useful for multi-user systems. */
  user_id?: string;

  /** The ID of the session during which the memory was created. Useful for tracking context in conversations. */
  session_id?: string;

  /** The status of the memory, e.g., 'activated', 'archived', 'deleted'. */
  status?: "activated" | "archived" | "deleted";

  /** The type of memory content. */
  type?: "procedure" | "fact" | "event" | "opinion" | "topic" | "reasoning";

  /**
   * The time the memory occurred or refers to.
   * Must be in standard `YYYY-MM-DD` format.
   * Relative expressions such as "yesterday" or "tomorrow" are not allowed.
   */
  memory_time?: string;

  /** The origin of the memory. */
  source?: "conversation" | "retrieved" | "web" | "file";

  /**
   * A numeric score (float between 0 and 100) indicating how certain
   * you are about the accuracy or reliability of the memory.
   */
  confidence?: number;

  /**
   * A list of key entities mentioned in the memory,
   * e.g., people, places, organizations.
   * Example: `["Alice", "Paris", "OpenAI"]`.
   */
  entities?: string[];

  /**
   * A list of keywords or thematic labels associated with the memory
   * for categorization or retrieval.
   * Example: `["travel", "health", "project-x"]`.
   */
  tags?: string[];

  /** Memory visibility scope: 'private', 'public', or 'session'. */
  visibility?: "private" | "public" | "session";

  /**
   * The timestamp of the last modification to the memory.
   * Useful for tracking memory freshness or change history.
   */
  updated_at?: number;
}

export const MemorySystemLogger = new Logger("MemorySystem");