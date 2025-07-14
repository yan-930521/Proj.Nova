import { MemoryEdge } from '../../application/memory/MemoryEdge';
import { MemoryNode } from '../../application/memory/MemoryNode';

export interface GraphRepository {
    save(graph: {
        nodes: Record<string, MemoryNode>;
        edges: Record<string, MemoryEdge[]>;
    }): Promise<boolean>;
    
    load(): Promise<{
        nodes: Record<string, MemoryNode>;
        edges: Record<string, MemoryEdge[]>;
    }>;
}