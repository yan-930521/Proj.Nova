import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { RunnableConfig } from '@langchain/core/runnables';
import {
    Annotation, END, MemorySaver, Send, START, StateDefinition, StateGraph, task, UpdateType
} from '@langchain/langgraph';

import { LevelDBTaskRepository } from '../frameworks/levelDB/LevelDBTaskRepository';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../libs/base/BaseSupervisor';
import { replaceCodeBlocksToTripleQuotes, restoreTripleQuotesInObject } from '../libs/utils/string';
import { Assistant, AssistantResponse } from './assistant/Assistant';
import { Session, SessionContext } from './SessionContext';
import { Task, TaskType } from './task/Task';
import { TaskOrchestrator } from './task/TaskOrchestrator';
import { Message, UserIO } from './user/UserIO';

StructuredOutputParser
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
    "taskCreate": [Task, Session]
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
        this.on("taskCreate", this.TaskOrchestrator.processTask.bind(this.TaskOrchestrator));

        // 注入parser
        StructuredOutputParser.prototype.parse = async function (text) {
            try {
                const json = text.includes("```")
                    ? text.trim().split(/```json/)[1]
                    : text.trim();
                const escapedJson = json
                    .replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (_match, capturedGroup) => {
                        const escapedInsideQuotes = replaceCodeBlocksToTripleQuotes(capturedGroup.replace(/\n/g, "\\n"));
                        return `"${escapedInsideQuotes}"`;
                    })
                    .replace(/\n/g, "");
                return await this.schema.parseAsync(restoreTripleQuotesInObject(JSON.parse(escapedJson)));
            } catch (e) {
                throw new Error(`Failed to parse. Text: "${text}". Error: ${e}`);
            }
        };
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

    }
}