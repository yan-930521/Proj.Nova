import { OpenAIEmbeddings } from '@langchain/openai';

import { ComponentContainer } from '../../../ComponentContainer';
import { Vectra } from '../../../frameworks/vectra/vectra';
import { Session } from '../../SessionContext';
import { EdgeType, MemoryEdge } from './MemoryEdge';
import { MemoryNode, NodeMemoryType } from './MemoryNode';
import { GraphNodeMetadata, NODES_PATH } from './MemoryTree';

export class NodeManager {
    public embedder: OpenAIEmbeddings;

    public nodes = new Map<string, MemoryNode>();
    public edges = new Map<string, MemoryEdge[]>();

    public currentMemorySize = {
        "WorkingMemory": 0,
        "LongTermMemory": 0,
        "UserMemory": 0,
    }

    public memorySize = {
        "WorkingMemory": 20,
        "LongTermMemory": 500,
        "UserMemory": 500,
    }

    constructor() {
        this.embedder = ComponentContainer.getLLMManager().getEmbedingModel();
    }

    getNode(memoryId: string): MemoryNode | null {
        return this.nodes.get(memoryId) ?? null;
    }

    getAllNodes() {
        return this.nodes;
    }

    getEdge(memoryId: string, edgeId: string): MemoryEdge | null {
        return (this.edges.get(memoryId) ?? []).find((e) => e.id == edgeId) || null;
    }

    getEdges(memoryId: string) {
        return this.edges.get(memoryId);
    }

    getParents(id: string): string[] {
        const parents: string[] = [];
        for (const [fromId, edgeList] of this.edges.entries()) {
            for (const edge of edgeList) {
                if (edge.to === id && this.nodes.has(fromId)) {
                    parents.push(fromId);
                }
            }
        }
        return parents;
    };

    // 獲取子節點（基於所有邊）
    getChildrenIds(id: string): string[] {
        return (this.getEdges(id) ?? [])
            .filter(edge => this.nodes.has(edge.to))
            .map(edge => edge.to);
    };

    getAllEdges() {
        return this.edges;
    }

    /**
     * 將tree變成格式化的字串
     */
    toString(_nodes: MemoryNode[] | null, session: Session | null, isDetail: boolean, topK?: number) {
        let nodes = _nodes ?? Array.from(this.nodes.values());
        if (session) nodes = nodes.filter((n) => {
            let r = true;
            if (n.metadata.user_id && n.metadata.user_id !== session.user.id) r = false;
            if (n.metadata.status !== "activated") r = false;
            if (n.metadata.memory_type == 'WorkingMemory') r = false;
            // if (n.metadata.session_id) {
            //     if (n.metadata.session_id !== session.id) r = false;
            // }
            return r;
        });

        // 建立子圖
        const visited = new Set<string>();
        const backgroundSet = new Set<string>();
        const lines: string[] = [];

        const printNode = (id: string, depth: number) => {
            if (visited.has(id)) return;
            visited.add(id);

            const node = this.getNode(id);
            if (!node ||
                (session && node.metadata.user_id && node.metadata.user_id !== session.user.id) ||
                node.metadata.memory_type == 'WorkingMemory' ||
                node.metadata.status != "activated"
            ) return;

            lines.push(`${'     '.repeat(depth * 2)} - [ ${node.metadata.key ?? node.memory ?? node.id} ]`);

            this.getChildrenIds(id).forEach(childId => printNode(childId, depth + 1));
        };

        const printNodeDetail = (id: string, depth: number) => {
            if (visited.has(id)) return;
            visited.add(id);

            const node = this.getNode(id);
            if (!node || node.metadata.memory_type == 'WorkingMemory') return;

            const indent = '  '.repeat(depth * 2);
            const title = node.metadata.key ?? node.memory ?? node.id;

            const padding = "   "
            lines.push(`${indent} - [ ${title} ]`);

            const memory = node.memory;
            lines.push(`${indent + padding}  memory: ${memory}`);

            const childrenIds = this.getChildrenIds(id);

            if (childrenIds.length == 0) {
                const status = node.metadata.status ?? 'unknown';
                const type = node.metadata.type ?? 'unknown';
                const memoryTime = node.metadata.memory_time ?? 'unknown';
                const source = node.metadata.source ?? 'unknown';
                const tags = (node.metadata.tags ?? []).join(', ') || 'none';
                lines.push(`${indent + padding}  status: ${status}`);
                lines.push(`${indent + padding}  type: ${type}`);
                lines.push(`${indent + padding}  source: ${source}`);
                lines.push(`${indent + padding}  tags: ${tags}`);
                if (node.metadata.background && !backgroundSet.has(node.metadata.background)) {
                    backgroundSet.add(node.metadata.background);
                    lines.push(`${indent + padding}  background: ${node.metadata.background}`);
                }
            } else {
                childrenIds.forEach((childId) => printNodeDetail(childId, depth + 1));
            }

        };

        const idList = nodes.map((n) => n.id);

        // 找出局部根節點（沒有被其他節點指向的節點）
        const childIds = new Set<string>();

        // 收集所有被任何邊指向的節點
        Array.from(this.edges.values()).forEach(edgeList => {
            edgeList.forEach(edge => {
                if (idList.includes(edge.from) && idList.includes(edge.to)) {
                    childIds.add(edge.to);
                }
            });
        });

        let rootCandidates = nodes.filter((n) => !childIds.has(n.id)).sort((a, b) => {
            let tb = b.metadata.updated_at ?? b.metadata.created_at ?? 0;
            let ta = a.metadata.updated_at ?? a.metadata.created_at ?? 0;
            return tb - ta;
        });

        if (topK) rootCandidates = rootCandidates.slice(0, topK);

        rootCandidates.forEach((can) => {
            if (isDetail) printNodeDetail(can.id, 0);
            else printNode(can.id, 0);
        });

        return lines.join('\n');
    }

    /**
     * Find nearest nodes by tags
     */
    getNeighborsByTag(tags: string[], excludeIds: string[] = [], topK: number = 5, minOverlap: number = 2): MemoryNode[] {
        const results: MemoryNode[] = Array.from(this.nodes.values()).filter((node) => (
            !excludeIds.includes(node.id) &&
            node.metadata.status == 'activated' &&
            node.metadata.memory_type != 'WorkingMemory' &&
            node.metadata.type != 'reasoning' &&
            (
                (node.metadata.tags ?? []).filter(tag => tags.includes(tag)).length >= minOverlap
            )
        ));
        // Sort by overlap count and return top K
        return results.sort((a, b) => (b.metadata.tags?.length ?? 0) - (a.metadata.tags?.length ?? 0)).slice(0, topK);
    }

    edgeExists(from: string, to: string, type: EdgeType): boolean {
        let edges = this.getEdges(from);
        if (edges) {
            let edge = edges.find((e) => e.to == to && e.type == type);
            if (edge) return true;
        }
        return false;
    }

    getMemorySize(scope: NodeMemoryType) {
        return this.currentMemorySize[scope];
    }

    async addNode(memoryNode: MemoryNode) {
        this.nodes.set(memoryNode.id, memoryNode);
        await Vectra.getInstance().upsertItem<GraphNodeMetadata>({
            id: NODES_PATH.replace("{node_id}", memoryNode.id),
            vector: memoryNode.metadata.embedding,
            metadata: this.createGraphNodeMetadata(memoryNode)
        });
    }

    saveNode = this.addNode;

    async deleteNode(memoryNode: MemoryNode) {
        memoryNode.metadata.status = 'deleted';
        await Vectra.getInstance().upsertItem<GraphNodeMetadata>({
            id: NODES_PATH.replace("{node_id}", memoryNode.id),
            vector: memoryNode.metadata.embedding,
            metadata: this.createGraphNodeMetadata(memoryNode)
        });
    }

    addEdge(edge: MemoryEdge) {
        let entry = this.edges.get(edge.from);
        if (!entry) {
            this.edges.set(edge.from, [edge]);
        } else {
            this.edges.get(edge.from)!.push(edge);
        }
        if (edge.type == 'PARENT') {
            this.getNode(edge.from)?.childrenIds.push(edge.to);
            let node = this.nodes.get(edge.from);
            if (node) node.parentId = edge.from;
        }
    }

    refreshMemorySize() {
        const newMemorySize = {
            "WorkingMemory": 0,
            "LongTermMemory": 0,
            "UserMemory": 0,
        }
        Array.from(this.nodes.values()).forEach((n) => newMemorySize[n.metadata.memory_type]++);
        this.currentMemorySize = newMemorySize;
    }

    createGraphNodeMetadata(memory: MemoryNode): GraphNodeMetadata {
        const metadata = structuredClone(memory.metadata);
        metadata.embedding = []
        return {
            namespace: NODES_PATH,
            id: memory.id,
            memory: memory.memory,
            ...metadata
        }
    }
}