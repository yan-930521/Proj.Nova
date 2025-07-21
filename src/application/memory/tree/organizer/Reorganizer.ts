import kmeans from 'kmeans-ts';
import { z } from 'zod';

import { ChatPromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts';
import { Runnable, RunnableConfig } from '@langchain/core/runnables';
import { ChatOpenAI, ChatOpenAICallOptions, OpenAIEmbeddings } from '@langchain/openai';

import { ComponentContainer } from '../../../../ComponentContainer';
import { MemorySystemLogger } from '../../base/Memory';
import {
    LOCAL_SUBCLUSTER_PROMPT, LOCAL_SUBCLUSTER_TYPE, REORGANIZE_PROMPT, REORGANIZE_TYPE
} from '../../memory';
import { MemoryEdge } from '../MemoryEdge';
import { MemoryNode, NodeMemoryType } from '../MemoryNode';
import { NodeManager } from '../NodeManager';
import { RelationReasoner } from './RelationReasoner';

export class Reorganizer {
    protected embedder: OpenAIEmbeddings;
    protected llm: ChatOpenAI<ChatOpenAICallOptions>;
    protected nodeManager: NodeManager;
    protected relationReasoner: RelationReasoner;

    protected reorganizerChain: Runnable<any, z.infer<typeof REORGANIZE_TYPE>>
    protected localSubclusterChain: Runnable<any, z.infer<typeof LOCAL_SUBCLUSTER_TYPE>>

    private isOptimizing: Record<string, boolean> = {
        "WorkingMemory": false,
        "LongTermMemory": false,
        "UserMemory": false,
    }

    constructor(nodeManager: NodeManager) {
        this.nodeManager = nodeManager;
        this.relationReasoner = new RelationReasoner(this.nodeManager);

        this.embedder = ComponentContainer.getLLMManager().getEmbedingModel();
        this.llm = ComponentContainer.getLLMManager().getLLM();

        this.reorganizerChain = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(REORGANIZE_PROMPT)
        ]).pipe(this.llm.withStructuredOutput(REORGANIZE_TYPE));

        this.localSubclusterChain = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(LOCAL_SUBCLUSTER_PROMPT)
        ]).pipe(this.llm.withStructuredOutput(LOCAL_SUBCLUSTER_TYPE))
    }

    /**
     * Periodically reorganize the graph:
     * 1. Weakly partition nodes into clusters.
     * 2. Summarize each cluster.
     * 3. Create parent nodes and build local PARENT trees.
     */
    async treeOptimize(
        scope: NodeMemoryType = "LongTermMemory",
        localTreeThreshold: number = 10,
        minClusterSize: number = 3,
        minGroupSize: number = 10,
    ) {
        if (this.isOptimizing[scope]) return MemorySystemLogger.debug(`Already optimizing for ${scope}. Skipping.`);
        this.nodeManager.refreshMemorySize();
        if (this.nodeManager.getMemorySize(scope) == 0) return MemorySystemLogger.debug(`No nodes for scope=${scope}. Skip.`);

        this.isOptimizing[scope] = true;

        try {
            MemorySystemLogger.debug(`Starting structure optimization for scope: ${scope}`);
            MemorySystemLogger.debug(`Num of scope is ${this.nodeManager.getMemorySize(scope)}`);

            // Load candidate nodes
            const nodes = this.getOptimizationCandidates(scope);

            if (nodes.length == 0) return MemorySystemLogger.debug(`No nodes to optimize. Skipping.`);

            if (nodes.length < minGroupSize) return MemorySystemLogger.debug(`Only ${nodes.length} candidate nodes found. Not enough to reorganize. Skipping.`);

            MemorySystemLogger.debug(`Loaded ${nodes.length} nodes.`);

            // Step 2: Partition nodes
            const partitionedGroups = this.partitionNodes(nodes, minClusterSize);

            MemorySystemLogger.debug(`Partitioned into ${partitionedGroups.length} clusters.`);

            for (const clusterNodes of partitionedGroups) {
                await this.processClusteAndWrite(clusterNodes, scope, localTreeThreshold, minClusterSize)
            }
        } catch (err) {
            MemorySystemLogger.warn(`Cluster processing failed: ${String(err)}`);
            MemorySystemLogger.info("Structure optimization finished.")
        } finally {
            this.isOptimizing[scope] = false;
            MemorySystemLogger.info("Structure optimization finished.")
        }
    }

    getOptimizationCandidates(scope: NodeMemoryType): MemoryNode[] {
        const nodeManager = this.nodeManager;
        function* findOptimizationCandidates(_nodes: Map<string, MemoryNode>, _scope: NodeMemoryType) {
            for (const [id, m] of _nodes.entries()) {
                if (
                    m.metadata.memory_type === _scope &&
                    m.metadata.status === 'activated'
                ) {
                    const children = nodeManager.getChildrenIds(id);
                    const parents = nodeManager.getParents(id);
                    
                    const isIsolated = parents.length === 0 && children.length === 0;
                    const isEmptyBackground = !m.metadata.background || m.metadata.background === '';
                    const hasExactlyOneChild = children.length === 1;

                    if (isIsolated || isEmptyBackground || hasExactlyOneChild) {
                        yield id;
                    }

                    if (hasExactlyOneChild) {
                        for (const childId of m.childrenIds) {
                            yield childId;
                        }
                    }
                }
            }
        }
        const nodes = new Set(findOptimizationCandidates(this.nodeManager.getAllNodes(), scope));
        const optimizedNodes = Array.from(nodes, id => this.nodeManager.getNode(id)).filter(m => m !== null);

        return optimizedNodes;
    }

    /**
     * Partition nodes by:
     *  1) Frequent tags (top N & above threshold)
     *  2) Remaining nodes by embedding clustering (MiniBatchKMeans)
     *  3) Small clusters merged or assigned to 'Other'
     */
    partitionNodes(nodes: MemoryNode[], minClusterSize: number = 3) {
        const { filteredTagClusters, assignedIds } = this.partitionFromTags(nodes, minClusterSize);

        // Remaining nodes -> embedding clustering
        const remainingNodes = nodes.filter((n) => !assignedIds.has(n.id) && n.metadata.embedding && Array.isArray(n.metadata.embedding))

        MemorySystemLogger.debug(`Remaining nodes for embedding clustering: ${remainingNodes.length}`);


        const { embeddingClusters } = this.partitionFromEmbedding(remainingNodes, minClusterSize);

        // Merge all & handle small clusters
        const allClusters = filteredTagClusters.concat(embeddingClusters);

        // Optional: merge tiny clusters
        const finalClusters: MemoryNode[][] = [];
        const smallNodes: MemoryNode[] = [];

        for (const group of allClusters) {
            if (group.length < minClusterSize) {
                smallNodes.push(...group);
            } else {
                finalClusters.push(group);
            }
        }

        if (smallNodes.length > 0) {
            finalClusters.push(smallNodes);
            MemorySystemLogger.debug(`${smallNodes.length} nodes assigned to 'Other' cluster.`);
        }

        MemorySystemLogger.debug(`Total final clusters: ${finalClusters.length}`);

        return finalClusters;
    }

    partitionFromTags(nodes: MemoryNode[], minClusterSize: number = 3) {
        const tagCounter: Record<string, number> = {}
        nodes.forEach((m) => m.metadata.tags?.forEach((tag) => {
            tagCounter[tag] = (tagCounter[tag] ?? 0) + 1;
        }));

        // Select frequent tags

        const sortedTags = Object.entries(tagCounter).sort((a, b) => b[1] - a[1]);
        const topNTags = sortedTags.slice(0, 50).map(([tag]) => tag);
        const thresholdTags = sortedTags.filter(([_, count]) => count >= 50).map(([tag]) => tag);
        const frequentTags = new Set([...topNTags, ...thresholdTags])

        // Group nodes by tags, ensure each group is unique internally
        const tagGroups = new Map<string, MemoryNode[]>();

        for (const node of nodes) {
            for (const tag of node.metadata.tags ?? []) {
                if (frequentTags.has(tag)) {
                    if (!tagGroups.has(tag)) {
                        tagGroups.set(tag, []);
                    }
                    tagGroups.get(tag)!.push(node);
                    break; // 只分配到第一個 frequent tag 群組
                }
            }
        }
        const filteredTagClusters: MemoryNode[][] = [];
        const assignedIds = new Set<string>();

        for (const [tag, group] of tagGroups.entries()) {
            if (group.length >= minClusterSize) {
                filteredTagClusters.push(group);
                for (const node of group) {
                    assignedIds.add(node.id);
                }
            } else {
                MemorySystemLogger.debug(`... dropped ${tag} ...`);
            }
        }
        MemorySystemLogger.debug(`Created ${filteredTagClusters.length} clusters from tags.`);
        MemorySystemLogger.debug(`Nodes grouped by tags: ${assignedIds.size} / ${nodes.length}`);

        return { filteredTagClusters, assignedIds }
    }

    partitionFromEmbedding(remainingNodes: MemoryNode[], minClusterSize: number = 3) {
        const embeddingClusters: MemoryNode[][] = [];

        const vectors: number[][] = remainingNodes.map(n => n.metadata.embedding as number[]);

        let k = Math.max(1, Math.min(Math.floor(vectors.length / minClusterSize), 20));
        if (vectors.length < k) {
            k = vectors.length;
        }

        if (k > 1 && k <= vectors.length) {
            const result = kmeans(vectors, k, 'kmeans++');
            const labelGroups = new Map<number, MemoryNode[]>();

            for (let i = 0; i < result.indexes.length; i++) {
                const label = result.indexes[i];
                if (!labelGroups.has(label)) {
                    labelGroups.set(label, []);
                }
                labelGroups.get(label)!.push(remainingNodes[i]);
            }

            embeddingClusters.push(...Array.from(labelGroups.values()));

            MemorySystemLogger.debug(`Created ${embeddingClusters.length} clusters from embedding.`);
        } else {
            // k = 1
            embeddingClusters.push(remainingNodes);
        }

        return {
            embeddingClusters
        }
    }

    async processClusteAndWrite(
        clusterNodes: MemoryNode[],
        scope: NodeMemoryType,
        localTreeThreshold: number,
        minClusterSize: number,
    ) {
        if (clusterNodes.length <= minClusterSize) return;
        if (clusterNodes.length <= localTreeThreshold) {
            // Small cluster ➜ single parent
            const parentNode = await this.summarizeCluster(clusterNodes, scope);
            await this.nodeManager.addNode(parentNode);
            this.linkClusterNodes(parentNode, clusterNodes);
        } else {
            // Large cluster ➜ local sub-clustering
            const subClusters = await this.localSubcluster(clusterNodes);
            const subParents: MemoryNode[] = [];
            for (const subNodes of subClusters) {
                if (subNodes.length < minClusterSize) {
                    // Skip tiny noise
                    continue;
                }
                const subParentNode = await this.summarizeCluster(subNodes, scope);
                await this.nodeManager.addNode(subParentNode);
                this.linkClusterNodes(subParentNode, subNodes);
                subParents.push(subParentNode);
            }

            if (subParents.length > 0) {
                const clusterParentNode = await this.summarizeCluster(clusterNodes, scope);
                await this.nodeManager.addNode(clusterParentNode);
                this.linkClusterNodes(clusterParentNode, subParents)
            }
        }

        MemorySystemLogger.debug(`Adding relations/reasons`);

        const excludeIds = clusterNodes.map((n) => n.id);

        const results = await Promise.all(clusterNodes.map((n) => this.relationReasoner.processNodes(n, excludeIds, 10)))

        for (const result of results) {
            // 1) Add pairwise relations
            for (const relation of result.relations) {
                if (!this.nodeManager.edgeExists(relation.source_id, relation.target_id, relation.relation_type)) {
                    this.nodeManager.addEdge(new MemoryEdge(
                        relation.source_id,
                        relation.target_id,
                        relation.relation_type
                    ));
                }
            }

            // 2) Add inferred nodes and link to sources
            for (const inferredNode of result.inferredNodes) {
                await this.nodeManager.addNode(inferredNode);
                for (const srcId in inferredNode.metadata.sources) {
                    this.nodeManager.addEdge(new MemoryEdge(
                        srcId,
                        inferredNode.id,
                        "INFERS"
                    ));
                }
            }

            // 3) Add sequence links
            for (const link of result.sequenceLinks) {
                if (!this.nodeManager.edgeExists(link.from, link.to, "FOLLOWS")) {
                    this.nodeManager.addEdge(new MemoryEdge(
                        link.from,
                        link.to,
                        "FOLLOWS"
                    ));
                }
            }

            // 4) Add aggregate concept nodes
            for (const aggregateNode of result.aggregateNodes) {
                await this.nodeManager.addNode(aggregateNode);
                for (const childId in aggregateNode.metadata.sources) {
                    this.nodeManager.addEdge(new MemoryEdge(
                        aggregateNode.id,
                        childId,
                        "AGGREGATES"
                    ));
                }
            }
        }

        MemorySystemLogger.debug(`Cluster relation/reasoning done.`);
    }

    /**
     * Generate a cluster label using LLM, based on top keys in the cluster.
     */
    async summarizeCluster(
        clusterNodes: MemoryNode[],
        scope: NodeMemoryType
    ) {
        if (clusterNodes.length == 0) {
            MemorySystemLogger.error("Cluster nodes cannot be empty.");
        }

        let joined_keys = "";
        let joined_values = "";
        let joined_backgrounds = "";
        clusterNodes.forEach((m) => {
            if (m.metadata.key) joined_keys += `- ${m.metadata.key}`;
            joined_values += `- ${m.memory}`;
            if (m.metadata.background) joined_backgrounds += `- ${m.metadata.background}`;
        });

        const result = await this.reorganizerChain.invoke({
            joined_keys,
            joined_values,
            joined_backgrounds
        });

        const embedding = await this.embedder.embedQuery(result.value);

        return new MemoryNode(result.value, {
            memory_type: scope,
            status: "activated",
            key: result.key,
            tags: result.tags,
            embedding,
            usage: [],
            sources: clusterNodes.map((m) => m.id),
            background: result.background,
            confidence: 0.99,
            type: "topic",
        });
    }

    /**
     * Add PARENT edges from the parent node to all nodes in the cluster.
     */
    linkClusterNodes(parentNode: MemoryNode, childNodes: MemoryNode[]) {
        for (let child of childNodes) {
            if (!this.nodeManager.edgeExists(parentNode.id, child.id, 'PARENT')) {
                this.nodeManager.addEdge(new MemoryEdge(parentNode.id, child.id, 'PARENT'))
            }
        }
    }

    /**
     * Use LLM to split a large cluster into semantically coherent sub-clusters.
     */
    async localSubcluster(clusterNodes: MemoryNode[]): Promise<MemoryNode[][]> {
        if (clusterNodes.length == 0) return [];
        // Prepare conversation-like input: ID + key + value
        const joined_scene = clusterNodes.map((n) => `- ID: ${n.id} | Key: ${n.metadata.key} | Value: ${n.memory}`).join("\n");

        const result = await this.localSubclusterChain.invoke({
            joined_scene
        });

        const assignedIds = new Set<string>()
        const resultSubclusters = [];

        for (const cluster of result.clusters) {
            const ids: string[] = [];
            cluster.ids.forEach((nid) => {
                if (!assignedIds.has(nid)) {
                    ids.push(nid);
                    assignedIds.add(nid);
                }
            });

            const subNodes = clusterNodes.filter((m) => ids.includes(m.id));
            if (subNodes.length >= 2) {
                resultSubclusters.push(subNodes);
            }
        }
        return resultSubclusters;
    }
}