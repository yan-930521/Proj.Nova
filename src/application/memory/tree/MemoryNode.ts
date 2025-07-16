import { getUid } from '../../../libs/utils/string';
import { MemoryMetadata } from '../base/Memory';

export type NodeMemoryType = "WorkingMemory" | "LongTermMemory" | "UserMemory";

/**
 * Metadata associated with a memory node, including lifecycle type,
 * semantic data, and usage tracking.
 */
export interface NodeMemoryMetadata extends MemoryMetadata {
    /** Memory lifecycle type. */
    memory_type: NodeMemoryType;

    /** Memory key or title. */
    key?: string;

    /** Multiple origins of the memory (e.g., URLs, notes). */
    sources?: string[];

    /** 
     * The vector embedding of the memory content,
     * used for semantic search or clustering.
     */
    embedding?: number[];

    /**
     * The timestamp of the first creation of the memory.
     * Useful for tracking memory initialization.
     */
    created_at?: number;

    /** Usage history of this node. */
    usage?: string[];

    /** Background of this node. */
    background?: string;
}

export class MemoryNode {
    public id: string;
    public memory: string;
    public metadata: NodeMemoryMetadata;

    /**
     * cache
     */
    public parentId?: string;

    /**
     * cache
     */
    public childrenIds: string[] = [];

    constructor(
        memory: string,
        metadata: NodeMemoryMetadata,
        id?: string
    ) {
        this.id = id ?? this.createId();
        this.memory = memory;
        this.metadata = metadata;
    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    createId(baseId: string = getUid()) {
        return "MemoryNode-" + baseId;
    }
}