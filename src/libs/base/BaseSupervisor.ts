import { z } from 'zod';

import { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { Runnable } from '@langchain/core/runnables';
import { Annotation, CompiledStateGraph, END, START, StateGraph } from '@langchain/langgraph';

import { BaseAgent, BaseAgentCallOptions } from './BaseAgent';
import { BaseComponent } from './BaseComponent';

export const BASE_SUPERVISOR_PROMPT =
    "You are a supervisor tasked with managing a conversation between the" +
    " following workers: {members}. Given the following user request," +
    " respond with the worker to act next. Each worker will perform a" +
    " task and respond with their results and status. When finished," +
    " respond with FINISH.";

export interface BaseSuperVisorCallOptions extends BaseAgentCallOptions {
    /**
     * member in a team
     */
    members?: Record<string, BaseComponent>;

    /**
     * options to act next
     */
    options?: string[] | []
}

/**
 * base supervisor to manage a team
 */
export abstract class BaseSuperVisor<T extends  Record<string, any> = {}> extends BaseAgent<T> implements BaseSuperVisorCallOptions {
    AgentState: ReturnType<typeof Annotation.Root<any>> = Annotation.Root({
        messages: Annotation<BaseMessage[]>({
            reducer: (x, y) => x.concat(y),
            default: () => [],
        }),
        next: Annotation<string>({
            reducer: (x, y) => y ?? x ?? END,
            default: () => END,
        }),
    });

    members: Record<string, BaseComponent | BaseAgent> = {};

    protected _options?: string[];
    protected _graph?: CompiledStateGraph<unknown, unknown>;
    declare protected _chain?: Runnable;

    constructor(options: BaseSuperVisorCallOptions = {}) {
        super(options);

        if (options.members) this.members = options.members;
        this._options = options.options;
    }

    get options(): string[] {
        if (!this._options) {
            throw new Error("Options is not defined for supervisor: " + this.name);
        }
        return this._options;
    }

    get memberlist(): (BaseComponent)[] {
        return Object.values(this.members);
    }

    get chain(): Runnable {
        if (!this._chain) {
            throw new Error("Chain is not defined for supervisor: " + this.name);
        }
        return this._chain;
    }

    get graph(): CompiledStateGraph<unknown, unknown> {
        if (!this._graph) {
            throw new Error("Graph is not defined for supervisor: " + this.name);
        }
        return this._graph;
    }

    set graph(_graph: CompiledStateGraph<unknown, unknown>) {
        this._graph = _graph;
    }

    routingTool() {
        let members = this.memberlist.map((member) => member.name);
        return {
            name: "route",
            description: "Select the next role.",
            schema: z.object({
                next: z.enum([END, ...members]),
            }),
        }
    }

    /**
     * 子類必須實作初始化邏輯
     */
    protected abstract initLogic(): Promise<void>;

    loadMember(member: BaseComponent): Promise<BaseComponent> {
        return new Promise(async (res, rej) => {
            try {
                await member.init();
                this.members[member.name] = member;
                if(!this.memberlist.includes(member)) {
                    this.memberlist.push(member);
                }
                res(member);
            } catch (err) {
                rej(this.handleError("Load Member failed."));
            }
        })
    }

    loadMembers(members?: BaseComponent[]) {
        if (!members) {
            return Promise.all(Object.values(this.members).map((member) => this.loadMember(member)));
        }

        return Promise.all(members.map((member) => {
            return this.loadMember(member);
        }));
    }

    getMember(memberName: string): BaseComponent | undefined {
        return this.memberlist.find((m) => m.name == memberName);
    }
}