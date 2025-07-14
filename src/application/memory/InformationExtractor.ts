import { z } from 'zod';

import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import {
    ChatPromptTemplate, PromptTemplate, SystemMessagePromptTemplate
} from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import {
    _INTERNAL_ANNOTATION_ROOT, Annotation, END, messagesStateReducer, START, StateGraph
} from '@langchain/langgraph';

import { ComponentContainer } from '../../ComponentContainer';
import { Task } from '../../domain/entities/Task';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../../libs/base/BaseSupervisor';
import {
    NAMED_ENTITIES_EXTRACTOR_PROMPT, NAMED_ENTITIES_EXTRACTOR_TYPE, TRIPLE_EXTRACTOR_PROMPT,
    TRIPLE_EXTRACTOR_TYPE
} from '../prompts/memory';
import { MemoryGraphState } from './MemoryGraph';

/***
 * call when collect lots of message
 */
export class InformationExtractor extends BaseSuperVisor {
    AgentState = MemoryGraphState;

    chains: {
        NamedEntitiesExtractor?: Runnable<any, z.infer<typeof NAMED_ENTITIES_EXTRACTOR_TYPE>>
        TripleExtractor?: Runnable<any, z.infer<typeof TRIPLE_EXTRACTOR_TYPE>>
    } = {}

    constructor(options?: BaseSuperVisorCallOptions) {
        super({
            name: "InformationExtractor",
            ...options
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = ComponentContainer.getLLMManager().getLLM();

        this.chains.NamedEntitiesExtractor = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(NAMED_ENTITIES_EXTRACTOR_PROMPT)
        ]).pipe(this.llm.withStructuredOutput(NAMED_ENTITIES_EXTRACTOR_TYPE));

        this.chains.TripleExtractor = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(TRIPLE_EXTRACTOR_PROMPT)
        ]).pipe(this.llm.withStructuredOutput(TRIPLE_EXTRACTOR_TYPE));

        this.createGraph();
    }

    async ner(state: typeof this.AgentState.State) {
        let response = await this.chains.NamedEntitiesExtractor?.invoke({
            passage: state.messages.map((m) => m.content).join("\n"),
        });

        if (response) {
            return {
                named_entities: response.named_entities
            }
        }
        return {
            named_entities: []
        }
    }

    async openie(state: typeof this.AgentState.State) {
        let response = await this.chains.TripleExtractor?.invoke({
            named_entities: state.named_entities,
            passage: state.messages.map((m) => m.content).join("\n"),
            user: state.task.user.toString()
        });

        if (response) {
            return {
                triple_list: response.triple_list
            }
        }
        return {
            triple_list: []
        }
    }

    createGraph() {
        const workflow = new StateGraph(this.AgentState);
        workflow.addNode("NER", this.ner.bind(this))
            .addNode("OPENIE", this.openie.bind(this))
            .addEdge(START, "NER")
            .addEdge("NER", "OPENIE")
            .addEdge("OPENIE", END);

        this.graph = workflow.compile();
    }
}