import { z } from 'zod';

import { DynamicStructuredTool } from '@langchain/core/tools';

import { UserState } from '../../../domain/entities/User';
import { getUid } from '../../../libs/utils/string';

export class MemoryNote {
    public dbId: string = "";
    public vector: number[] = [];
    
    public id: string = MemoryNote.createId();
    public userId: string = "";
    public type: string = "general";
    public content: string = "None";
    public keywords: string[] = [];
    public context: string = "General";

    /**
     * 情緒
     */
    public sentiment: string = "neutral";
    /**
     * 用於分類的標籤
     */
    public category: string = "Uncategorized";
    /**
     * 用於分類的額外標籤
     */
    public tags: string[] = [];

    /**
     *  重要程度 / 類似記憶被搜尋過的次數
     */
    public importance: number = 0.5;
    public evolutionHistory: Partial<MemoryNote>[] = [];
    public timestamp: string = new Date().toISOString();
    public lastAccessed: string = new Date().toISOString();
    /**
     * 相關記憶
     */
    public relatedMemories: string[] = [];

    /**
     * 額外屬性
     */
    public metadata: Record<string, any> = {};
    constructor() {
    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    static createId(baseId: string = getUid()) {
        return "MemoryNote-" + baseId;
    }

    static fromJson(data: Partial<MemoryNote>) {
        // 驗證資料結構
        let n = new MemoryNote();
        Object.assign(n, data);
        return n;
    }

    toJson(): Partial<MemoryNote> {
        return {
            id: this.id,
            userId: this.userId,
            type: this.type,
            content: this.content,
            keywords: this.keywords,
            context: this.context,
            category: this.category,
            tags: this.tags,
            importance: this.importance,
            evolutionHistory: this.evolutionHistory,
            timestamp: this.timestamp,
            lastAccessed: this.lastAccessed,
            relatedMemories: this.relatedMemories,
            sentiment: this.sentiment,
            metadata: this.metadata,
        }
    }

    /**
     * 記錄演化歷史（只存關鍵欄位）
     */
    recordEvolution() {
        this.evolutionHistory.push({
            content: this.content,
            timestamp: this.timestamp,
            importance: this.importance,
            tags: [...this.tags],
            category: this.category,
            sentiment: this.sentiment
        });
    }

    /**
     * Updates the content and the updated_at timestamp.
     * @param new_content 
     */
    updateContent(new_content: string) {
        if (this.content != new_content) {
            this.recordEvolution();
            this.content = new_content;
            this.touch();
        }
    }

    /**
     * Update metadata fields and the updated_at timestamp.
     * @param updates 
     * @param overwrite 
     */
    updateMetadata(updates: Record<string, any>, overwrite: boolean) {
        if (overwrite) {
            this.recordEvolution();
            this.metadata = { ...updates };
        } else {
            for (let i in updates) {
                this.metadata[i] = updates[i];
            }
        }
        this.touch();
    }

    /**
     * Adds a tag to the tags list if not already present.
     * @param tag 
     */
    addTag(tag: string) {
        if (!this.tags.includes(tag)) {
            this.recordEvolution();
            this.tags.push(tag);
            this.touch();
        }
    }

    touch() {
        this.importance += 0.1;
        this.lastAccessed = new Date().toISOString();
    }
}

export type UpdateMode = "patch" | "insert";

export interface MemoryConfig {
    tool: DynamicStructuredTool<any>;
    systemPrompt: string;
    updateMode: UpdateMode;
}

export const MemoryNoteSchema = z.object({
    type: z.string().default("general")
        .describe("The overall type or nature of the conversation or request (e.g., 'general', 'support', 'feedback')."),
    keywords: z.array(z.string()).default([])
        .describe("Key terms or phrases mentioned in the user's input."),
    sentiment: z.enum(["neutral", "happy", "angry", "sad", "confused"])
        .default("neutral")
        .describe("Detected emotional sentiment from the user's input."),
    category: z.string()
        .default("Uncategorized")
        .describe("General classification label for the input."),
    tags: z.array(z.string())
        .default([])
        .describe("Additional labels for flexible filtering, search, or tagging."),
    context: z.string().describe(
        "The situation or circumstance where this memory may be relevant. " +
        "Include any caveats or conditions that contextualize the memory. " +
        "For example, if a user shares a preference, note if it only applies " +
        "in certain situations (e.g., 'only at work'). Add any other relevant " +
        "'meta' details that help fully understand when and how to use this memory.",
    ),
    content: z.string().describe("The specific information, preference, or event being remembered.")
});

export const NoteMemoryTool = new DynamicStructuredTool({
    name: "note",
    description: "Save notable memories the user has shared with you for later recall.",
    schema: MemoryNoteSchema,
    func: async (input) => {
        return JSON.stringify(input, null, 4);
    },
});

export const UserMemoryTool = new DynamicStructuredTool({
    name: "user",
    description: "Update this document to maintain up-to-date information about the user in the conversation.",
    schema: UserState,
    func: async (input) => {
        return JSON.stringify(input, null, 4);
    },
});

export const DEFAULT_MEMORY_CONFIG: MemoryConfig[] = [
    {
        systemPrompt: "",
        updateMode: 'insert',
        tool: NoteMemoryTool
    },
    {
        systemPrompt: "",
        updateMode: 'patch',
        tool: UserMemoryTool
    }
]