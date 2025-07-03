import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Runnable, RunnableConfig } from '@langchain/core/runnables';
import { CompiledStateGraph, StateDefinition, StateType } from '@langchain/langgraph';
import { ChatOpenAI, ChatOpenAICallOptions } from '@langchain/openai';

import { BaseComponent, BaseComponentCallOptions } from './BaseComponent';

export type BaseAgentLLMType = ChatOpenAI<ChatOpenAICallOptions>

export interface BaseAgentCallOptions extends BaseComponentCallOptions {
    /**
     * llm for agent
     */
    llm?: BaseAgentLLMType;

    /**
     * llm with prompt
     */
    chain?: CompiledStateGraph<any, any, string> | Runnable;

    /**
     * description for agent
     */
    description?: string;

    /**
     * prompt for agent, may be undefind
     */
    prompt?: ChatPromptTemplate;
}

export abstract class BaseAgent<ParentStateType extends StateType<any> = {}> extends BaseComponent implements BaseAgentCallOptions {
    protected _llm?: BaseAgentLLMType;
    protected _chain?: CompiledStateGraph<any, any, string, StateDefinition, StateDefinition, StateDefinition> | Runnable<any, any, RunnableConfig<Record<string, any>>>;
    protected _description?: string;
    protected _prompt?: ChatPromptTemplate;

    constructor(options: BaseAgentCallOptions) {
        super(options);
        this._llm = options.llm;
        this._description = options.description;
        this._chain = options.chain;
        this._prompt = options.prompt;
    }

    get llm(): BaseAgentLLMType {
        if (!this._llm) {
            throw new Error("LLM is not defined for agent: " + this.name);
        }
        return this._llm;
    }

    get prompt(): ChatPromptTemplate {
        if (!this._prompt) {
            throw new Error("Prompt is not defined for agent: " + this.name);
        }
        return this._prompt;
    }

    get description(): string {
        if (!this._description) {
            throw new Error("Description is not defined for agent: " + this.name);
        }
        return this._description;
    }

    get chain(): CompiledStateGraph<any, any, string, StateDefinition, StateDefinition, StateDefinition> | Runnable<any, any, RunnableConfig<Record<string, any>>> {
        if (!this._chain) {
            throw new Error("Chain is not defined for agent: " + this.name);
        }
        return this._chain;
    }

    /**
     * 子類必須實作 node
     */
    abstract node(state: ParentStateType): any;

    /**
     * 釋放資源
     */
    public override dispose() {
        super.dispose();
        // 若有額外資源可於此釋放
    }
}