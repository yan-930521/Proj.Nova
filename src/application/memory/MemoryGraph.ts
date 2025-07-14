import { z } from 'zod';

import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
    Annotation, END, messagesStateReducer, Send, START, StateGraph
} from '@langchain/langgraph';

import { ComponentContainer } from '../../ComponentContainer';
import { Task } from '../../domain/entities/Task';
import { LevelDBGraphRepository } from '../../frameworks/levelDB/LevelDBGraphRepository';
import {} from '../../frameworks/levelDB/LevelDBUserRepository';
import { Vectra } from '../../frameworks/vectra/vectra';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../../libs/base/BaseSupervisor';
import { BaseState } from '../Nova';
import { TRIPLE_TYPE } from '../prompts/memory';
import { InformationExtractor } from './InformationExtractor';
import { MemoryEdge } from './MemoryEdge';
import { MemoryNode, NodeType } from './MemoryNode';

export const MemoryGraphState = Annotation.Root({
    ...BaseState.spec,

    named_entities: Annotation<string[]>,

    triple_list: Annotation<z.infer<typeof TRIPLE_TYPE>[]>,

});

export const PASSAGE_PATH = 'passage/{node_id}';
export const FACT_PATH = 'fact/{node1_id}/{edge_id}/{node2_id}';
export interface PassageMetadata {
    namespace: string,
    content: string,
    name: string,
    uid: string
}

export interface FactMetadata {
    namespace: string,
    content: string,

    subjectName: string,
    subjectUid: string,

    objectName: string,
    objectUid: string,

    edgeUid: string
}
export class MemoryGraph extends BaseSuperVisor {
    AgentState = MemoryGraphState;

    private nodes: Map<string, MemoryNode> = new Map();
    private edges: Map<string, MemoryEdge[]> = new Map();

    constructor(options?: BaseSuperVisorCallOptions) {
        super({
            name: "MemoryGraph",
            ...options
        });
    }

    initLogic(): Promise<void> {
        return new Promise(async (res, rej) => {
            try {
                this._llm = ComponentContainer.getLLMManager().getLLM();

                await this.loadMembers([
                    new InformationExtractor()
                ]);

                await this.loadGraph();

                this.createGraph();

                res();
            } catch (err) {
                rej(this.handleError(err));
            }
        });
    }

    private ensureNode(name: string, type: NodeType): MemoryNode {
        let entry = this.nodes.get(name);
        if (!entry) {
            entry = new MemoryNode(null, type, name);
            this.nodes.set(name, entry);
        }
        return entry;
    }

    private addEdge(name: string, edge: MemoryEdge): void {
        let entry = this.edges.get(name);
        if (!entry) {
            this.edges.set(name, [edge]);
        } else {
            this.edges.get(name)!.push(edge);
        }
    }

    /**
     * save fact
     */
    private async saveFactTriple(node1: MemoryNode, edge: MemoryEdge, node2: MemoryNode) {

        const embeding = ComponentContainer.getLLMManager().getEmbedingModel();

        const path = FACT_PATH.replace('{node1_id}', node1.uid).replace('{node2_id}', node2.uid).replace('{edge_id}', edge.uid);
        const content = `${node1.name} ${edge.content} ${node2.name}`;

        const vector = await embeding.embedQuery(content);

        const document = {
            id: path,
            vector,
            metadata: {
                namespace: FACT_PATH,
                content,

                subjectName: node1.name,
                subjectUid: node1.uid,

                objectName: node2.name,
                objectUid: node2.name,

                edgeUid: edge.uid
            } as FactMetadata
        }

        await Vectra.getInstance().upsertItem(document);

    }

    private async retrieveFact(query: string, nodes: MemoryNode[], k: number = 5, d = 2) {
        const embeding = ComponentContainer.getLLMManager().getEmbedingModel();

        const vector = await embeding.embedQuery(query);

        const results = await Vectra.getInstance().queryItems<FactMetadata>(vector, k, {
            // @ts-ignore
            "namespace": { "$eq": FACT_PATH }
        });

        const visited = new Set<string>();
        const triples: [string, string, string][] = [];
        const contents: string[] = [];


        // Graph 擴展

        const recursiveSearch = (node: MemoryNode, depth: number) => {
            if (visited.has(node.uid) || depth <= 0) return;
            visited.add(node.uid);

            const tempTriple: string[] = [];

            tempTriple[0] = node.name;

            // 向外擴展
            const edges = this.edges.get(node.name) || [];
            edges.forEach((edge) => {
                tempTriple[1] = edge.content;
                const targetNode = this.nodes.get(edge.linkTo);
                if (targetNode) {
                    tempTriple[2] = targetNode.name;
                    triples.push(Object.assign({}, tempTriple) as [string, string, string]);
                    recursiveSearch(targetNode, depth - 1);
                }
            });
        };

        results.forEach((res) => {
            let node1 = this.nodes.get(res.item.metadata.subjectName);
            if (node1) recursiveSearch(node1, d);
            let node2 = this.nodes.get(res.item.metadata.objectName);
            if (node2) recursiveSearch(node2, d);
            if (res.item.metadata.content) {
                contents.push(res.item.metadata.content);
            }
        });

        nodes.forEach(m => recursiveSearch(m, d));

        return contents.concat(triples.map((t) => t.join(" ")));
    }

    async savePassageNode(node: MemoryNode) {
        const embeding = ComponentContainer.getLLMManager().getEmbedingModel();

        const path = PASSAGE_PATH.replace('{node_id}', node.uid);

        if (node.observations.length != 0) {
            // 直接覆蓋成最新的
            const vector = await embeding.embedQuery(node.observations.join("\n"));

            const document = {
                id: path,
                vector,
                metadata: {
                    namespace: PASSAGE_PATH,
                    content: node.observations.join("\n"),
                    name: node.name,
                    uid: node.uid
                }
            }

            await Vectra.getInstance().upsertItem(document);
        }
    }

    async index(state: typeof BaseState.State): Promise<void> {
        const stream = await this.graph.stream(
            {
                messages: [
                    new HumanMessage(state.task.userInput)
                ],
                task: state.task
            }
        );

        try {
            for await (const step of stream) {
                console.log(step, "---")
            }

        } catch (err) {
            this.logger.error(String(err));
        }

    }

    async retrieve(state: typeof BaseState.State): Promise<any> {
        const embeding = ComponentContainer.getLLMManager().getEmbedingModel();

        // page rank
        // 搜尋最相關的passage

        const vector = await embeding.embedQuery(state.task.userInput);

        const results = await Vectra.getInstance().queryItems<PassageMetadata>(vector, 3, {
            // @ts-ignore
            "namespace": { "$eq": PASSAGE_PATH }
        });

        const nodes: MemoryNode[] = [];
        let passageContents: string[] = []

        // 從相關的passage node深入搜尋
        // 不怕重複
        results.forEach((res) => {
            let node = this.nodes.get(res.item.metadata.name);
            if (node) nodes.push(node);
            passageContents.push(res.item.metadata.content);
        });

        let factContents = await this.retrieveFact(state.task.userInput, nodes);

        console.log(passageContents.concat(factContents).join("\n"))


        return {
            memories: passageContents.concat(factContents).join("\n")
        }
        // return passageContents.concat(factContents);
    }

    createGraph() {
        const workflow = new StateGraph(MemoryGraphState);

        const _InformationExtractor_ = this.members["InformationExtractor"] as InformationExtractor;

        workflow
            .addNode(_InformationExtractor_.name, _InformationExtractor_.graph)
            .addNode("AddFactEdges", this.addFactEdges.bind(this))
            .addNode("AddPassageEdges", this.addPassageEdges.bind(this))
            .addEdge(START, _InformationExtractor_.name)
            .addEdge(_InformationExtractor_.name, "AddFactEdges")
            .addEdge("AddFactEdges", "AddPassageEdges")
            .addEdge("AddPassageEdges", END);

        this.graph = workflow.compile();
    }

    async informationExtract(state: typeof MemoryGraphState.State) {
        const _InformationExtractor_ = this.members["InformationExtractor"] as InformationExtractor;
        const stream = await _InformationExtractor_.graph.stream(
            {
                messages: state.messages,
                task: state.task
            }
        );

        let lastStep;
        for await (const step of stream) {
            if (step["OPENIE"]) lastStep = step["OPENIE"];
        }

        return {
            triple_list: lastStep.triple_list ?? []
        }
    }

    async addFactEdges(state: typeof MemoryGraphState.State) {
        const {
            triple_list
        } = state;
        for (const triple of triple_list) {
            let subjectNode = this.ensureNode(triple.subject, 'phrase');
            let objectNode = this.ensureNode(triple.object, 'phrase');

            let factEdge = new MemoryEdge(null, 'relation', objectNode.name);
            factEdge.content = triple.predicate;

            this.addEdge(subjectNode.name, factEdge);

            await this.saveFactTriple(subjectNode, factEdge, objectNode);
        }
        return {}
    }

    async addPassageEdges(state: typeof MemoryGraphState.State) {
        const {
            task,
            messages,
            triple_list
        } = state;

        let msg = messages.map(m => m.content as string);
        let passageNode = this.ensureNode(task.timestamp, 'passage');
        passageNode.observations = msg;

        for (const triple of triple_list) {
            let subjectNode = this.ensureNode(triple.subject, 'phrase');
            let objectNode = this.ensureNode(triple.object, 'phrase');

            // 不能共用 因為uid要不同
            let subjectPassageEdge = new MemoryEdge(null, 'context', passageNode.name)
            let objectPassageEdge = new MemoryEdge(null, 'context', passageNode.name)

            this.addEdge(subjectNode.name, subjectPassageEdge);
            this.addEdge(objectNode.name, objectPassageEdge);
        }

        await this.savePassageNode(passageNode);
        return {}
    }

    addSynonymyEdges() {

    }

    async saveGraph() {
        let data = this.toJSON();
        let success = await LevelDBGraphRepository.getInstance().save(data);
        if (success) {
            this.logger.debug("save graph success");
        } else {
            this.logger.debug("save graph failed");
        }
    }

    async loadGraph() {
        let data = await LevelDBGraphRepository.getInstance().load();
        this.fromJSON({
            nodes: data.nodes ?? {},
            edges: data.edges ?? {}
        });
    }

    fromJSON({
        nodes, edges
    }: {
        nodes: Record<string, MemoryNode>,
        edges: Record<string, MemoryEdge[]>
    }) {

        for (const [key, node] of Object.entries(nodes)) {
            let nd = new MemoryNode(node.uid, node.type, node.name);
            Object.assign(nd, node);
            this.nodes.set(key, nd);
        }

        for (const [key, edgeList] of Object.entries(edges)) {
            this.edges.set(key, edgeList.map(e => {
                let ed = new MemoryEdge(
                    e.uid,
                    e.type,
                    e.linkTo
                );
                Object.assign(ed, e);
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

        for (const [key, node] of this.nodes.entries()) {
            nodesObj[key] = node;
        }
        for (const [key, edgeList] of this.edges.entries()) {
            edgesObj[key] = edgeList;
        }

        return {
            nodes: nodesObj,
            edges: edgesObj,
        };
    }
}