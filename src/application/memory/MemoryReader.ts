import { z } from 'zod';

import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import {
    ChatPromptTemplate, PromptTemplate, SystemMessagePromptTemplate
} from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import {
    _INTERNAL_ANNOTATION_ROOT, Annotation, END, messagesStateReducer, START, StateGraph
} from '@langchain/langgraph';
import { OpenAIEmbeddings } from '@langchain/openai';

import { ComponentContainer } from '../../ComponentContainer';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../../libs/base/BaseSupervisor';
import { MEMORY_EXTRACTOR_PROMPT, MEMORY_EXTRACTOR_TYPE } from '../prompts/memory';
import { Session } from '../SessionContext';
import { Message } from '../user/UserIO';
import { MemorySystemLogger } from './base/Memory';
import { MemoryNode } from './tree/MemoryNode';

/***
 * 用來閱讀記憶/知識/訊息
 */
export class MemoryReader extends BaseSuperVisor {

    // @ts-ignore
    chains: {
        MemoryExtractor: Runnable<any, z.infer<typeof MEMORY_EXTRACTOR_TYPE>>
    } = {}

    constructor(options?: BaseSuperVisorCallOptions) {
        super({
            name: "MemoryReader",
            ...options
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = ComponentContainer.getLLMManager().getLLM();
        this._embedder = ComponentContainer.getLLMManager().getEmbedingModel();

        this.chains.MemoryExtractor = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(MEMORY_EXTRACTOR_PROMPT)
        ]).pipe(this.llm.withStructuredOutput(MEMORY_EXTRACTOR_TYPE));
    }

    async extractFromMessages(session: Session, messages: Message[] = []): Promise<MemoryNode[]> {
        MemorySystemLogger.debug("Extract memory from messages");
        if(messages.length == 0) {
            messages = session.context.recentMessages;
        }
        const conversation = messages.map((m) => {
            return `[${new Date(m.timestamp).toLocaleString()}] ${m.type}: ${m.content}`
        }).join("\n");

        session.context.recentMessages = [];
        await ComponentContainer.getNova().SessionContext.update(session.user.id, session);

        const result = await this.chains.MemoryExtractor.invoke({
            conversation
        });

        const nodes = await Promise.all(result.memory_list.map(async (m) => {
            let embedding = await this.embedder.embedQuery(m.value);
            return new MemoryNode(
                m.value,
                {
                    session_id: session.id,
                    user_id: session.user.id,
                    key: m.key,
                    memory_type: m.memory_type,
                    status: "activated",
                    tags: m.tags,
                    embedding,
                    usage: [],
                    source: "conversation",
                    created_at: Date.now(),
                    updated_at: Date.now(),
                    confidence: 0.99,
                    background: result.summary,
                    type: "fact"
                }
            )
        }))

        return nodes;
    }
}