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
/**
 * todo
 * 1. limit node amouts
 * 2. merge function
 */
export class MemoryTree {
    public id: string;

    public nodeManager: NodeManager;
    public reorganizer: Reorganizer;

    public mergeThreshold = 0.9;
    public similarThreshold = 0.8;

    public embedder: OpenAIEmbeddings;
    constructor(
        id?: string
    ) {
        this.id = id ?? this.createId();

        this.embedder = ComponentContainer.getLLMManager().getEmbedingModel();
        this.nodeManager = new NodeManager()
        this.reorganizer = new Reorganizer(this.nodeManager);

    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    createId(baseId: string = getUid()) {
        return "MemoryTree-" + baseId;
    }

    async add(memories: MemoryNode[]) {
        MemorySystemLogger.debug(`Add memories: \n${memories.map((n) => n.memory).join("\n")}`);
        // Step 1: process memory
        await Promise.all(memories.map((m) => this.processMemory(m)));

        // Step 2: remove oldest memory

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
            memory_type: memory.metadata.memory_type,
            status: "activated"
        })).filter((r) => r.score >= this.similarThreshold);

        const similarNodes = results
            .filter((r) => {
                let m = this.nodeManager.getNode(r.item.id)
                return (m != null) && (m.metadata.status == "activated") // 重新確認
            });

        if (similarNodes.length > 0 && similarNodes[0].score >= this.mergeThreshold) {
            // this.merge()
        } else {
            // Step 2: Add new node to graph
            await this.nodeManager.addNode(memory);
        }
    }

    removeOldestMemory(memort_type: NodeMemoryType, keep: number) {

    }

    async search(
        query: string, topK: number, session: Session
    ) {
        MemorySystemLogger.debug("Searching: " + query);
        // 搜尋最相關的節點
        const vector = await this.embedder.embedQuery(query);

        const results = await this.searchByMetadata(vector, topK, {
            user_id: session.user.id,
            status: "activated",
            memory_type: ['LongTermMemory', 'UserMemory']
        });// search pudding

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

        return this.nodeManager.toDetailString(nodes);
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

    async saveGraph(id: string = this.id) {
        let data = this.toJSON();
        let success = await LevelDBGraphRepository.getInstance().save(id, data);
        if (success) {
            MemorySystemLogger.debug("save graph success");
        } else {
            MemorySystemLogger.debug("save graph failed");
        }
    }

    async loadGraph(id: string = this.id) {
        let data = await LevelDBGraphRepository.getInstance().load(id);
        this.fromJSON({
            nodes: data.nodes ?? {},
            edges: data.edges ?? {}
        });
        MemorySystemLogger.debug("load graph success");
    }

    fromJSON({
        nodes, edges
    }: {
        nodes: Record<string, MemoryNode>,
        edges: Record<string, MemoryEdge[]>
    }) {
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

    toJSON(): {
        nodes: Record<string, MemoryNode>;
        edges: Record<string, MemoryEdge[]>;
    } {
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