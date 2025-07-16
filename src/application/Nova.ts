import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { RunnableConfig } from '@langchain/core/runnables';
import {
    Annotation, END, MemorySaver, Send, START, StateDefinition, StateGraph, task, UpdateType
} from '@langchain/langgraph';

import { Task, TaskType } from '../domain/entities/Task';
import { LevelDBTaskRepository } from '../frameworks/levelDB/LevelDBTaskRepository';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../libs/base/BaseSupervisor';
import { Assistant, AssistantResponse } from './assistant/Assistant';
import { Session, SessionContext } from './SessionContext';
import { TaskOrchestrator } from './task/TaskOrchestrator';
import { Message, UserIO } from './user/UserIO';

export const BaseState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),

    /**
     * 追加記憶
     */
    memories: Annotation<string>({
        reducer: (_, action) => action,
        default: () => "",
    }),

    session: Annotation<Session>,
    task: Annotation<Task>,

    call_task: Annotation<boolean>
});

export const JSONOutputToolsParser = new JsonOutputToolsParser<{
    type: string,
    args: Record<string, string>,
    id: string
}[]>({ returnId: true });

export interface NovaEvents {
    "messageCreate": [Message],
    "messageDispatch": [Session],
    "taskCreate": [Session, Task]
}

export class Nova extends BaseSuperVisor<NovaEvents> {
    AgentState = BaseState;

    Assistant = new Assistant();
    TaskOrchestrator = new TaskOrchestrator();
    UserIO = new UserIO();
    SessionContext = new SessionContext();

    constructor(options: BaseSuperVisorCallOptions = {}) {
        super({
            name: options?.name ?? "Nova"
        });
    }

    protected async initLogic(): Promise<void> {
        await this.loadMembers([this.Assistant, this.TaskOrchestrator, this.UserIO, this.SessionContext]);
        
        this.on("messageCreate", this.UserIO.handleMessageCreate.bind(this.UserIO));
        this.on("messageDispatch", this.Assistant.handleMessageDispatch.bind(this.Assistant));
        this.on("taskCreate", this.TaskOrchestrator.handleTaskCreate.bind(this.TaskOrchestrator));
    }

    /**
     * @deprecated
     */
    async processInput(task: Task) {
        const threadConfig = {
            configurable: {
                thread_id: task.user.id, // 使用用戶ID作為線程ID，但確認任務歸屬之後就使用任務id
            }
        };

        try {
            const stream = await this.graph.stream(
                {
                    messages: [
                        new HumanMessage(task.userInput)
                    ],
                    task
                } as Partial<typeof BaseState.State>,
                {
                    ...threadConfig,
                    signal: task.forceExit.signal
                }
            );

            let lastStep;
            for await (const step of stream) {
                lastStep = step;
                this.logger.debug("---", step);
            }
        } catch (err) {
            console.error(err);
            const _TaskOrchestrator_ = this.members["TaskOrchestrator"] as TaskOrchestrator;
            _TaskOrchestrator_.runingTasks[task.id] = false;
        }

        // }
        // }
    }
}