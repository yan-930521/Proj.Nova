import { z } from 'zod';

import { ChatPromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import { ChatOpenAI, ChatOpenAICallOptions, OpenAIEmbeddings } from '@langchain/openai';

import { ComponentContainer } from '../../../../ComponentContainer';
import {
    AGGREGATE_PROMPT, AGGREGATE_TYPE, INFER_FACT_PROMPT, INFER_FACT_TYPE, LOCAL_SUBCLUSTER_PROMPT,
    LOCAL_SUBCLUSTER_TYPE, PAIRWISE_RELATION_PROMPT, PAIRWISE_RELATION_TYPR, REORGANIZE_PROMPT,
    REORGANIZE_TYPE
} from '../../../prompts/memory';
import { EdgeType } from '../MemoryEdge';
import { MemoryNode } from '../MemoryNode';
import { NodeManager } from '../NodeManager';

export interface RelationResult {
    source_id: string;
    target_id: string;
    relation_type: EdgeType;
}

export interface SequenceLink {
    from: string;
    to: string;
}

export interface ProcessNodesResult {
    relations: RelationResult[];
    inferredNodes: MemoryNode[];
    sequenceLinks: SequenceLink[];
    aggregateNodes: MemoryNode[];
}

export class RelationReasoner {
    protected embedder: OpenAIEmbeddings;
    protected llm: ChatOpenAI<ChatOpenAICallOptions>;
    protected nodeManager: NodeManager;

    protected pairwiseChain: Runnable<any, z.infer<typeof PAIRWISE_RELATION_TYPR>>
    protected inferFactChain: Runnable<any, z.infer<typeof INFER_FACT_TYPE>>
    protected aggregateChain: Runnable<any, z.infer<typeof AGGREGATE_TYPE>>
    constructor(nodeManager: NodeManager) {
        this.nodeManager = nodeManager;
        this.embedder = ComponentContainer.getLLMManager().getEmbedingModel();
        this.llm = ComponentContainer.getLLMManager().getLLM();

        this.pairwiseChain = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(PAIRWISE_RELATION_PROMPT)
        ]).pipe(this.llm.withStructuredOutput(PAIRWISE_RELATION_TYPR));

        this.inferFactChain = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(INFER_FACT_PROMPT)
        ]).pipe(this.llm.withStructuredOutput(INFER_FACT_TYPE));

        this.aggregateChain = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(AGGREGATE_PROMPT)
        ]).pipe(this.llm.withStructuredOutput(AGGREGATE_TYPE));
    }

    /**
     * Unified pipeline for:
     *  1) Pairwise relations (cause, condition, conflict, relate)
     *  2) Inferred nodes
     *  3) Sequence links
     *  4) Aggregate concepts
     */
    async processNodes(node: MemoryNode, excludeIds: string[], topK: number = 5): Promise<ProcessNodesResult> {
        if (node.metadata.type === "reasoning") {
            // Skip reasoning for inferred node
            return {
                relations: [],
                inferredNodes: [],
                sequenceLinks: [],
                aggregateNodes: [],
            };
        }

        const results: ProcessNodesResult = {
            relations: [],
            inferredNodes: [],
            sequenceLinks: [],
            aggregateNodes: [],
        };

        const nearest = this.nodeManager.getNeighborsByTag(
            node.metadata.tags ?? [],
            excludeIds,
            topK,
            2 // min_overlap
        );

        // Pairwise relations (including CAUSE/CONDITION/CONFLICT)
        results.relations = await this.detectPairwiseRelations(node, nearest);

        // Inferred nodes (from causal/condition)
        results.inferredNodes = await this.inferFactNodesFromRelations(results.relations);

        // Sequence (optional, if you have timestamps)
        results.sequenceLinks = this.detectSequenceLinks(node, nearest);

        // Aggregate
        const agg = await this.detectAggregateNodeForGroup(node, nearest, 3);
        if (agg) {
            results.aggregateNodes.push(agg);
        }

        return results;
    }

    protected async detectPairwiseRelations(node: MemoryNode, nearestNodes: MemoryNode[]): Promise<RelationResult[]> {
        const results: RelationResult[] = [];
        for (const candidate of nearestNodes) {
            const result = await this.pairwiseChain.invoke({
                node1: node.memory,
                node2: candidate.memory
            })
            const relationType = result.relationship;
            if (relationType !== "NONE") {
                results.push({
                    source_id: node.id,
                    target_id: candidate.id,
                    relation_type: relationType,
                });
            }
        }
        return results;
    }

    protected async inferFactNodesFromRelations(pairwiseResults: RelationResult[]): Promise<MemoryNode[]> {
        const inferredNodes: MemoryNode[] = [];
        for (const rel of pairwiseResults) {
            if (rel.relation_type === "CAUSE" || rel.relation_type === "CONDITION") {
                const src = this.nodeManager.getNode(rel.source_id);
                const tgt = this.nodeManager.getNode(rel.target_id);
                if (!src || !tgt) continue;

                const result = await this.inferFactChain.invoke({
                    source: src.memory,
                    target: tgt.memory,
                    relation_type: rel.relation_type
                })
                const embedding = await this.embedder.embedQuery(result.inference);

                inferredNodes.push(
                    new MemoryNode(
                        result.inference,
                        {
                            user_id: "",
                            session_id: "",
                            memory_type: "LongTermMemory",
                            status: "activated",
                            key: `InferredFact:${rel.relation_type}`,
                            tags: ["inferred"],
                            embedding,
                            usage: [],
                            sources: [src.id, tgt.id],
                            background: `Inferred from ${rel.relation_type}`,
                            confidence: 0.9,
                            type: "reasoning",
                        }

                    )
                );
            }
        }
        return inferredNodes;
    }

    protected detectSequenceLinks(node: MemoryNode, nearestNodes: MemoryNode[]): SequenceLink[] {
        const results: SequenceLink[] = [];
        if (!node.metadata.updated_at) return [];
        for (const cand of nearestNodes) {
            if (!cand.metadata.updated_at) continue;
            if (cand.metadata.updated_at < node.metadata.updated_at) {
                results.push({ from: cand.id, to: node.id });
            } else if (cand.metadata.updated_at > node.metadata.updated_at) {
                results.push({ from: node.id, to: cand.id });
            }
        }
        return results;
    }

    protected async detectAggregateNodeForGroup(
        node: MemoryNode,
        nearestNodes: MemoryNode[],
        minGroupSize: number = 3
    ): Promise<MemoryNode | null> {
        if (nearestNodes.length < minGroupSize) return null;
        const joined = [node, ...nearestNodes].map(n => `- ${n.memory}`).join("\n");

        const result = await this.aggregateChain.invoke({
            joined
        });

        const embedding = await this.embedder.embedQuery(result.value);

        return new MemoryNode(
            result.value, {
            user_id: "",
            session_id: "",
            memory_type: node.metadata.memory_type,
            status: "activated",
            key: result.key,
            tags: result.tags || [],
            embedding,
            usage: [],
            sources: nearestNodes.map(n => n.id),
            background: result.background || "",
            confidence: 0.99,
            type: "reasoning",
        });
    }
}