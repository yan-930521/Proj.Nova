import { MemoryEdge } from '../../application/memory/tree/MemoryEdge';
import { MemoryNode } from '../../application/memory/tree/MemoryNode';

export interface GraphRepository {
    save(grapgId: string, graph: {
        nodes: Record<string, MemoryNode>;
        edges: Record<string, MemoryEdge[]>;
    }): Promise<boolean>;
    
    load(grapgId: string): Promise<{
        nodes: Record<string, MemoryNode>;
        edges: Record<string, MemoryEdge[]>;
    }>;
}