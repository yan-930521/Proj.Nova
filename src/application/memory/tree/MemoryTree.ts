import { QueryResult } from 'vectra';

import { OpenAIEmbeddings } from '@langchain/openai';

import { ComponentContainer } from '../../../ComponentContainer';
import { LevelDBGraphRepository } from '../../../frameworks/levelDB/LevelDBGraphRepository';
import { Vectra } from '../../../frameworks/vectra/vectra';
import { getUid } from '../../../libs/utils/string';
import { Session } from '../../SessionContext';
import { MemorySystemLogger } from '../base/Memory';
import { MemoryEdge } from './MemoryEdge';
import { MemoryNode, NodeMemoryMetadata, NodeMemoryType } from './MemoryNode';
import { NodeManager } from './NodeManager';
import { Reorganizer } from './organizer/Reorganizer';

export const NODES_PATH = 'nodes/{node_id}';

export interface GraphNodeMetadata extends NodeMemoryMetadata {
    namespace: string;
    id: string;
    memory: string;
}

export interface MemoryTreeData {
    nodes: Record<string, MemoryNode>;
    edges: Record<string, MemoryEdge[]>;
}

/**
 * todo
 * 1. limit node amouts
 * 2. merge function
 */
export class MemoryTree {
    public nodeManager: NodeManager;
    public reorganizer: Reorganizer;

    public mergeThreshold = 0.7;
    public similarThreshold = 0.6;

    public embedder: OpenAIEmbeddings;
    constructor() {
        this.embedder = ComponentContainer.getLLMManager().getEmbedingModel();
        this.nodeManager = new NodeManager()
        this.reorganizer = new Reorganizer(this.nodeManager);
    }

    async add(memories: MemoryNode[]) {
        let mem_str = memories.map((n) => {
            return n.memory;
        }).join("\n");

        MemorySystemLogger.debug(`Add memories: \n${mem_str}`);

        // Step 1: process memory
        // await Promise.all(memories.map((m) => this.processMemory(m)));
        // 同時對儲存node導致檔案衝突錯誤

        for (const m of memories) {
            await this.processMemory(m);
        }

        // Step 2: remove oldest memory
        this.removeOldestMemory("WorkingMemory");
        this.removeOldestMemory("LongTermMemory");
        this.removeOldestMemory("UserMemory");

        this.nodeManager.refreshMemorySize();
    }

    async processMemory(memory: MemoryNode) {
        //  Add to WorkingMemory
        await this.addDBMemory(memory, "WorkingMemory");

        // Add to LongTermMemory and UserMemory
        if (["LongTermMemory", "UserMemory"].includes(memory.metadata.memory_type)) {
            await this.addGraphMemory(memory, memory.metadata.memory_type);
        }
    }

    async getWorkingMemory(session: Session | null) {
        if (!session) {
            const workingMemories = Array.from(this.nodeManager
                .getAllNodes()
                .values())
                .filter(
                    (node) =>
                        node.metadata.memory_type === "WorkingMemory" &&
                        node.metadata.status === "activated"
                );
            return workingMemories;
        } else {
            const userId = session.user.id;
            const workingMemories = Array.from(this.nodeManager
                .getAllNodes()
                .values())
                .filter(
                    (node) =>
                        node.metadata.memory_type === "WorkingMemory" &&
                        node.metadata.user_id === userId &&
                        node.metadata.status === "activated"
                );
            return workingMemories;
        }
    }

    /**
     * Add a single memory item to the graph store, with FIFO logic for WorkingMemory.
     */
    async addDBMemory(memory: MemoryNode, memory_type: NodeMemoryType) {
        let metadata = structuredClone(memory.metadata);
        metadata.memory_type = memory_type;
        metadata.updated_at = Date.now();
        let workingMemory = new MemoryNode(memory.memory, metadata);

        await this.nodeManager.addNode(workingMemory);
    }

    async addGraphMemory(memory: MemoryNode, memory_type: NodeMemoryType) {
        // Step 1: Find similar nodes for possible merging

        if (!memory.metadata.embedding) memory.metadata.embedding = await this.embedder.embedQuery(memory.memory);

        const results = (await this.searchByMetadata(memory.metadata.embedding, 5, {
            user_id: memory.metadata.user_id,
            memory_type: memory_type,
            status: "activated"
        })).filter((r) => r.score >= this.similarThreshold);

        const similarNodes = results
            .filter((r) => {
                let m = this.nodeManager.getNode(r.item.id)
                return (m != null) && (m.metadata.status == "activated") // 重新確認
            });

        if (similarNodes.length > 0 && similarNodes[0].score >= this.mergeThreshold) {
            const similarNodeId = similarNodes[0].item.id;
            const similarNode = this.nodeManager.getNode(similarNodeId);
            MemorySystemLogger.debug("Similar Nodes " + similarNodeId);
            if (similarNode) this.merge(memory, similarNode);
        } else {
            // Step 2: Add new node to graph
            await this.nodeManager.addNode(memory);
        }
    }

    async merge(sourceNode: MemoryNode, targetNode: MemoryNode) {
        const originalId = targetNode.id;

        const mergedText = `${targetNode.memory}\n⟵MERGED⟶\n${sourceNode.memory}`;

        const embedding = await this.embedder.embedQuery(mergedText);

        const mergedMetadata: NodeMemoryMetadata = {
            ...sourceNode.metadata,
            key: sourceNode.metadata.key ?? targetNode.metadata.key,
            tags: this.mergeUnique(targetNode.metadata.tags, sourceNode.metadata.tags),
            sources: this.mergeUnique(targetNode.metadata.sources, sourceNode.metadata.sources),
            background: `${targetNode.metadata.background || ''}\n⟵MERGED⟶\n${sourceNode.metadata.background || ''}`,
            confidence: ((targetNode.metadata.confidence ?? 0.5) + (sourceNode.metadata.confidence ?? 0.5)) / 2,
            usage: this.mergeUnique(targetNode.metadata.usage, sourceNode.metadata.usage),
            embedding,
            updated_at: Date.now(),
        };

        const mergedNode = new MemoryNode(mergedText, mergedMetadata);

        // 將 merged node 加入 nodeManager
        await this.nodeManager.addNode(mergedNode);

        // 將原本兩個節點標記為 archived 並加入記錄
        const archivedSource = new MemoryNode(sourceNode.memory, {
            ...sourceNode.metadata,
            status: 'archived',
        });

        targetNode.metadata.status = "archived";

        this.nodeManager.addNode(archivedSource);
        this.nodeManager.saveNode(targetNode);

        // 建立 MERGED_TO 邊
        this.nodeManager.addEdge(new MemoryEdge(originalId, mergedNode.id, 'MERGED_TO'));
        this.nodeManager.addEdge(new MemoryEdge(archivedSource.id, mergedNode.id, 'MERGED_TO'));

        // 繼承 original 所有 outbound edge（但避免 MERGED_TO 再繼承）
        const originalEdges = this.nodeManager.getEdges(originalId) ?? [];
        for (const edge of originalEdges) {
            if (edge.type === 'MERGED_TO') continue;
            this.nodeManager.addEdge(new MemoryEdge(mergedNode.id, edge.to, edge.type));
        }

    }

    /**
     * 合併陣列並去重
     */
    mergeUnique<T>(a: T[] = [], b: T[] = []) {
        return Array.from(new Set([...a, ...b]));
    }

    removeOldestMemory(memort_type: NodeMemoryType) {
        const keep = this.nodeManager.memorySize[memort_type]; // 10
        Array.from(this.nodeManager.getAllNodes().values())
            .filter((n) => n.metadata.memory_type == "WorkingMemory")
            .sort((a, b) => {
                let tb = b.metadata.updated_at ?? b.metadata.created_at ?? 0;
                let ta = a.metadata.updated_at ?? a.metadata.created_at ?? 0;
                return tb - ta;// 由近排序到遠
            })
            .forEach((n, i) => {
                // 0 - 9
                if (i >= keep) {
                    // all delete
                    this.nodeManager.deleteNode(n);
                }
            });
    }

    async search(
        query: string, topK: number, session: Session | null
    ) {
        MemorySystemLogger.debug("Searching: " + query);
        // 搜尋最相關的節點
        const vector = await this.embedder.embedQuery(query);

        let results: QueryResult<GraphNodeMetadata>[];

        if (!session) {
            results = await this.searchByMetadata(vector, topK, {
                status: "activated",
                memory_type: ['LongTermMemory', 'UserMemory']
            });
        }
        else {
            results = await this.searchByMetadata(vector, topK, {
                user_id: session.user.id,
                status: "activated",
                memory_type: ['LongTermMemory', 'UserMemory']
            });
        }

        const visited = new Set<string>();
        const nodes: MemoryNode[] = [];


        // Graph 擴展
        const recursiveSearch = (node: MemoryNode) => {
            if (visited.has(node.id)) return;
            visited.add(node.id);
            nodes.push(node);

            // 向外擴展
            node.childrenIds.forEach((childId) => {
                let child = this.nodeManager.getNode(childId);
                if (child) recursiveSearch(child);
            });
        };

        results.forEach((res) => {
            let node = this.nodeManager.getNode(res.item.metadata.id);
            if (node) recursiveSearch(node);
        });

        return nodes;
    }

    async searchByMetadata(vector: number[], k: number = 3, metadata: Partial<NodeMemoryMetadata> | Record<string, any> = {}): Promise<QueryResult<GraphNodeMetadata>[]> {
        const results = await Vectra.getInstance().queryItems<GraphNodeMetadata>(vector, k, {
            // @ts-ignore
            "namespace": { "$eq": NODES_PATH },
            // @ts-ignore
            ...this.buildMetadataQuery(metadata)
        });

        return results;
    }

    buildMetadataQuery(metadata: Partial<NodeMemoryMetadata> | Record<string, any>): Record<string, any> {
        const query: Record<string, any> = {};

        for (const [key, value] of Object.entries(metadata)) {
            if (value === undefined || value === null) continue;

            if (Array.isArray(value)) {
                // 對 array 欄位使用 $in 查詢（e.g., tags, sources, entities）
                if (value.length > 0) {
                    query[key] = { "$in": value };
                }
            } else if (typeof value === "string" || typeof value === "number") {
                // 對 string/number 欄位使用精確查詢
                query[key] = { "$eq": value };
            }
        }

        return query;
    }

    fromJSON({
        nodes, edges
    }: MemoryTreeData) {
        this.nodeManager.nodes.clear();
        this.nodeManager.edges.clear();
        for (const [key, node] of Object.entries(nodes)) {
            let nd = new MemoryNode(node.memory, node.metadata, node.id);
            this.nodeManager.nodes.set(key, nd);
        }

        for (const [key, edgeList] of Object.entries(edges)) {
            this.nodeManager.edges.set(key, edgeList.map(e => {
                let ed = new MemoryEdge(
                    e.from,
                    e.to,
                    e.type,
                    e.id
                );
                return ed;
            }));
        }

    }

    toJSON(): MemoryTreeData {
        const nodesObj: Record<string, MemoryNode> = {};
        const edgesObj: Record<string, MemoryEdge[]> = {};

        for (const [key, node] of this.nodeManager.getAllNodes().entries()) {
            nodesObj[key] = node;
        }
        for (const [key, edgeList] of this.nodeManager.getAllEdges()) {
            edgesObj[key] = edgeList;
        }

        return {
            nodes: nodesObj,
            edges: edgesObj,
        };
    }
}