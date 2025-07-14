import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable, RunnableConfig } from '@langchain/core/runnables';
import { CompiledStateGraph, StateDefinition, StateType } from '@langchain/langgraph';
import { ChatOpenAI, ChatOpenAICallOptions } from '@langchain/openai';

import { BaseComponent, BaseComponentCallOptions } from './BaseComponent';

export type BaseAgentLLMType = ChatOpenAI<ChatOpenAICallOptions>

export interface BaseAgentCallOptions extends BaseComponentCallOptions {
    /**
     * llm with prompt
     */
    chain?: CompiledStateGraph<any, any, string> | Runnable;

    /**
     * prompt for agent, may be undefind
     */
    prompt?: ChatPromptTemplate;
}

export abstract class BaseAgent<T extends  Record<string, any> = {}> extends BaseComponent<T> implements BaseAgentCallOptions {
    protected _chain?: CompiledStateGraph<any, any, string, StateDefinition, StateDefinition, StateDefinition> | Runnable<any, any, RunnableConfig<Record<string, any>>>;
    protected _llm?: ChatOpenAI<ChatOpenAICallOptions>
    protected _prompt?: ChatPromptTemplate;

    constructor(options: BaseAgentCallOptions) {
        super(options);

        this._chain = options.chain;
        this._prompt = options.prompt;
    }

    get prompt(): ChatPromptTemplate {
        if (!this._prompt) {
            throw new Error("Prompt is not defined for agent: " + this.name);
        }
        return this._prompt;
    }
    
    get llm(): ChatOpenAI<ChatOpenAICallOptions>{
        if (!this._llm) {
            throw new Error("LLM is not defined for agent: " + this.name);
        }
        return this._llm;
    }

    get chain(): CompiledStateGraph<any, any, string, StateDefinition, StateDefinition, StateDefinition> | Runnable<any, any, RunnableConfig<Record<string, any>>> {
        if (!this._chain) {
            throw new Error("Chain is not defined for agent: " + this.name);
        }
        return this._chain;
    }

    /**
     * 釋放資源
     */
    public override dispose() {
        super.dispose();
        // 若有額外資源可於此釋放
    }

    node(state: any, config: any) : any {

    }
}