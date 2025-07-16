import { z } from 'zod';

import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
    ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate
} from '@langchain/core/prompts';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Annotation, END, messagesStateReducer, START, StateGraph } from '@langchain/langgraph';

import { ComponentContainer } from '../../ComponentContainer';
import { Character as CharacterObj, ICharacter } from '../../domain/entities/Character';
import { Task } from '../../domain/entities/Task';
import { LevelDBDiaryRepository } from '../../frameworks/levelDB/LevelDBDiaryRepository';
import { LevelDBTaskRepository } from '../../frameworks/levelDB/LevelDBTaskRepository';
import { BaseSuperVisor } from '../../libs/base/BaseSupervisor';
import { getUid } from '../../libs/utils/string';
import { JSONOutputToolsParser } from '../Nova';
import { BASE_CHARACTER_PROMPT, ExtendDiary } from '../prompts/character';
import { getReplyfromSession, Session } from '../SessionContext';

export interface AssistantResponse {
    reasoning: string,
    response: string,
    wordsCount: number
}

export const AssistantState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    input: Annotation<string>({
        reducer: (_, action) => action,
        default: () => "",
    }),

    session: Annotation<Session>,
    call_task: Annotation<boolean>,

    /**
     * 用於暫存回應
     */
    response_metadata: Annotation<AssistantResponse>({
        reducer: (_, action) => action,
        default: () => {
            return {
                reasoning: "",
                response: "",
                wordsCount: 0
            }
        },
    }),

    character: Annotation<ICharacter>({
        reducer: (_, action) => action,
        default: () => {
            // if (this.memoryManager && this.memoryManager.get()) return this.memoryManager.getDefaultPersonality()
            return {
                name: "",
                id: "",
                description: [],
                greeting: [],
                context: [],
                personality: [],
                placeholders: {},
                rules: [],
                history: []
            }
        },
    })
});

export const ReasoningOutputTool = new DynamicStructuredTool({
    name: "reasoning_tool",
    description: "從第一人稱視角思考目前情境，並判斷是否為任務導向的請求。",
    schema: z.object({
        reasoning: z.string()
            .describe("從第一人稱視角分析，並且詳細推理當前情況。不能在這裡提到任務協調者。"),
        call_task: z.boolean().describe("是否為任務。")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const ResponseOutputTool = new DynamicStructuredTool({
    name: "response_tool",
    description: "Generate a response based on reasoning in the tone of a text message",
    schema: z.object({
        response: z.string()
            .describe("Generate a response based on reasoning in the tone of a text message")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const CallTaskOrchestrator = new DynamicStructuredTool({
    name: "call_task_orchestrator",
    description: "分配任務給任務處理器處理。",
    schema: z.object({
        task: z.string()
            .describe("任務的詳細描述、需求、目標。")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

/**
 * 負責與用戶交互的代理人
 */
export class Assistant extends BaseSuperVisor {
    AgentState = AssistantState;

    static readonly REASONING_MODE = "REASONING_MODE";
    static readonly GENERAL_MODE = "GENERAL_MODE";
    static readonly DIARY_MODE = "DIARY_MODE";

    constructor() {
        super({
            name: "Assistant"
        });
    }

    initLogic(): Promise<void> {
        return new Promise(async (res, rej) => {
            try {
                ComponentContainer.getLLMManager().create(Assistant.REASONING_MODE, {
                    temperature: 0.2,
                    maxTokens: 1024,
                    model: "gpt-4.1",
                });

                this._llm = ComponentContainer.getLLMManager().getLLM();

                this._prompt = Assistant.loadPrompt();

                this._chain = this.prompt.pipe(this.llm);

                this.graph = this.createWorkflow().compile();

                res();
            } catch (err) {
                rej(this.handleError(err));
            }
        })
    }

    static formatCharacter(data: any, character: ICharacter) {
        for (let i in data) {
            if (Array.isArray(data[i]) && data[i][0] && typeof data[i][0] === "string") {
                data[i] = data[i].join("\n");
            }
            if (typeof data[i] === "string") {
                data[i] = data[i]
                    .replace(/{{char}}/g, character.name)
                    .replace(/{{user}}/g, data.user.name || "UnknownUser");
            }
        }
        return data;
    }

    /**
     * 載入prompt
     */
    static loadPrompt() {
        return ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(BASE_CHARACTER_PROMPT),
            HumanMessagePromptTemplate.fromTemplate("{input}")
        ]);
    }

    /**
     * 如果訊息太多，存檔，否則終止對話
     */
    shouldContinue(state: typeof this.AgentState.State): string | typeof END {
        const messages = state.messages;
        // 簡單說就是寫日記
        if (messages.length > 19) {
            return Assistant.DIARY_MODE;
        }

        return END;
    }

    /**
     * 決定是否思考 / 用於快速響應
     */
    modeRouter(state: typeof this.AgentState.State): string | typeof END {
        this.logger.debug("Mode routing...");
        return Assistant.REASONING_MODE;
    }

    async genReasoning(state: typeof this.AgentState.State) {
        this.logger.debug("Generating Reasoning...");

        const { messages, character, input, session } = state;

        const llm = ComponentContainer.getLLMManager().getLLM(Assistant.REASONING_MODE);

        const context = await ComponentContainer.getContextManager().getContextById(session.user.id);

        const result = await this.prompt.pipe(
            llm.bindTools([ReasoningOutputTool], { tool_choice: ReasoningOutputTool.name })
                .pipe(JSONOutputToolsParser)).invoke(
                    Assistant.formatCharacter({
                        description: character.description,
                        personality: character.personality,
                        user: session.user,
                        rules: character.rules,
                        context,
                        messages,
                        input,
                    }, character)
                );

        let reasoning = result[0].args.reasoning;
        let call_task = result[0].args.call_task as unknown as boolean ?? false;

        let wordsCount = reasoning.length;
        this.logger.debug(`[reasoning]: ${reasoning}`);

        session.context.inputMessages.push({
            content: `[reasoning]: ${reasoning}`,
            type: 'assistant',
            user: session.user,
            timestamp: Date.now(),
            reply: () => { }
        });

        // 儲存起來 不wait
        ComponentContainer.getNova().SessionContext.update(session.user.id, session);


        if (call_task) {
            return {
                messages: [
                    new HumanMessage({
                        id: getUid(),
                        content: input
                    })
                ],
                call_task,
                response_metadata: {
                    reasoning: reasoning,
                    response: "### Calling TaskOrchestrator...",
                    wordsCount: wordsCount ?? 0
                },
                session
            }
        }

        return {
            messages: [
                new HumanMessage({
                    id: getUid(),
                    content: input
                }),
                new AIMessage({
                    id: getUid(),
                    content: `[reasoning]: ${reasoning}`
                })
            ],
            call_task,
            response_metadata: {
                reasoning: reasoning ?? "",
                response: "",
                wordsCount: wordsCount ?? 0
            },
            session
        };

    }

    async genResponse(state: typeof this.AgentState.State) {
        this.logger.debug("Generating Response...");

        const { character, input, session, response_metadata, call_task } = state;

        const context = await ComponentContainer.getContextManager().getContextById(session.user.id);

        let newState: Partial<typeof this.AgentState.State> = {}

        if (call_task) {
            newState = await this.callTaskOrchestrator(state);
            state.messages = state.messages.concat(newState.messages ?? []);
            state.response_metadata = newState.response_metadata ?? state.response_metadata;

            return {
                ...state,
                response_metadata: {
                    reasoning: response_metadata.reasoning ?? "",
                    response: response_metadata.response ?? "",
                    wordsCount: response_metadata.wordsCount
                }
            }
        } else {
            const result = await this.prompt.pipe(
                this.llm.bindTools([ResponseOutputTool], { tool_choice: ResponseOutputTool.name })
                    .pipe(JSONOutputToolsParser)).invoke(
                        Assistant.formatCharacter({
                            description: character.description,
                            personality: character.personality,
                            user: session.user,
                            rules: character.rules,
                            context,
                            messages: state.messages,
                            input,
                        }, character)
                    )

            let response = result[0].args.response;
            let wordsCount = response.length;
            this.logger.debug(`[response]: ${response}`);

            session.context.inputMessages.push({
                content: `[response]: ${response}`,
                type: 'assistant',
                user: session.user,
                timestamp: Date.now(),
                reply: () => { }
            });

            // 儲存起來 不wait
            ComponentContainer.getNova().SessionContext.update(session.user.id, session);

            return {
                ...state,
                messages: [
                    new AIMessage({
                        id: getUid(),
                        content: `[response]: ${response}`
                    })
                ],
                response_metadata: {
                    reasoning: response_metadata.reasoning ?? "",
                    response: response ?? "",
                    wordsCount: response_metadata.wordsCount + (wordsCount ?? 0)
                }
            };
        }
    }

    async callTaskOrchestrator(state: typeof this.AgentState.State) {
        this.logger.debug("Calling TaskOrchestrator...");

        const { messages, character, input, session, response_metadata } = state;

        const context = await ComponentContainer.getContextManager().getContextById(session.user.id);


        const llm = ComponentContainer.getLLMManager().getLLM();

        const result = await this.prompt.pipe(
            llm.bindTools([CallTaskOrchestrator], { tool_choice: CallTaskOrchestrator.name }).pipe(JSONOutputToolsParser)
        ).invoke(
            Assistant.formatCharacter({
                description: character.description,
                personality: character.personality,
                user: session.user,
                rules: character.rules,
                context,
                messages,
                input,
            }, character)
        )

        // console.log(response)
        let task_str = result[0].args.task;
        let wordsCount = task_str.length;
        this.logger.debug(`[task]: ${task_str}`);

        session.context.inputMessages.push({
            content: `[task]: ${task_str}`,
            type: 'assistant',
            user: session.user,
            timestamp: Date.now(),
            reply: () => { }
        });

        const task = new Task({
            user: session.user,
            userInput: input,
            description: task_str
        });
        setTimeout(() => task.forceExit.abort(), 60000 * 6);
        await LevelDBTaskRepository.getInstance().create(task);
        ComponentContainer.getNova().emit("taskCreate", session, task);

        // 儲存起來 不wait
        ComponentContainer.getNova().SessionContext.update(session.user.id, session);

        return {
            messages: [
                new AIMessage({
                    id: getUid(),
                    content: `[task]: ${task_str}`
                })
            ],
            response_metadata: {
                reasoning: response_metadata.reasoning ?? "",
                response: response_metadata.response ?? "",
                wordsCount: response_metadata.wordsCount + (wordsCount ?? 0)
            }
        };

    }

    async writeDiary(state: typeof this.AgentState.State) {
        this.logger.debug("Writing Diary...");

        const { messages, character, session } = state;

        const context = await ComponentContainer.getContextManager().getContextById(session.user.id);

        const response = await this.chain.invoke(
            Assistant.formatCharacter({
                description: character.description,
                personality: character.personality,
                user: session.user,
                rules: character.rules,
                context,
                messages,
                input: ExtendDiary,
            }, character)
        )

        // 刪除8則
        // const deleteMessages = messages.slice(0, -8).map((m: HumanMessage) => new RemoveMessage({ id: m.id as string }));
        // if (typeof response.content !== "string") {
        //     throw new Error("Expected a string response from the model");
        // }

        // 更新日記
        await LevelDBDiaryRepository.getInstance().update(
            new Date().toLocaleDateString(),
            response.content
        );

        this.logger.debug(`[diary]: ${response.content}`);

        // return { messages: deleteMessages };
    }

    async handleMessageDispatch(session: Session) {
        let inputs: string[] = [];
        session.context.inputMessages.forEach((m) => {
            if(m.type == 'user') inputs.push(m.content);
        });

        const getTimeDetail = (timestamp: number) => {
            let d = new Date(timestamp);
            return `[${d.toLocaleString()}]`;
        }

        // 上一輪的合併進去 messages
        session.context.messages.push(...session.context.inputMessages);
        session.context.recentMessages.push(...session.context.inputMessages);
        session.context.messages = session.context.messages.sort((a, b) => a.timestamp - b.timestamp);

        session.context.inputMessages = [];
        let reply = getReplyfromSession(session);

        let messages: BaseMessage[] = session.context.messages
            .slice(session.context.messages.length - 20)
            .map((m) => m.type == "user" ?
                new HumanMessage(`${getTimeDetail(m.timestamp)}: ${m.content}`) :
                new AIMessage(`${getTimeDetail(m.timestamp)}: ${m.content}`
                ));

        const defatultCharacter = await CharacterObj.getDefaultCharacter();

        const threadConfig = {
            configurable: { thread_id: session.id }
        };

        const stream = await this.graph.stream(
            {
                input: inputs.join("\n"),
                character: defatultCharacter,
                messages,
                session
            },
            threadConfig
        );

        try {
            let lastStep;
            for await (const step of stream) {
                if (step[Assistant.GENERAL_MODE]) lastStep = step;
            }

            if (reply) reply({
                assistant: lastStep[Assistant.GENERAL_MODE].response_metadata
            });

            return {
                call_task: lastStep.call_task
            }
        } catch (err) {
            this.logger.error(String(err));
            if (reply) reply({
                assistant: {
                    reasoning: "...",
                    response: "遠端伺服器錯誤，請稍後嘗試...",
                    wordsCount: 0
                }
            });
        }
    }

    //     async handleTaskComplete() {
    //     ComponentContainer.getNova().on("taskComplete", async (msgs: UserMessage[]) => {
    //         // get session
    //         let session = this.SessionContext.get(msgs[0].authorId);

    //         const defatultCharacter = await CharacterObj.getDefaultCharacter();

    //         const threadConfig = {
    //             configurable: { thread_id: session.authorId }
    //         };

    //         task.description = task.final_report != "" ? `任務: ${task.description}\n執行結果: \n${task.final_report}` : ``

    //         const stream = await this.graph.stream(
    //             {
    //                 input: task.userInput,
    //                 task: task,
    //                 character: defatultCharacter,
    //                 user: session.user
    //             },
    //             threadConfig
    //         );

    //         try {
    //             let lastStep;
    //             for await (const step of stream) {
    //                 if (step[Assistant.GENERAL_MODE]) lastStep = step;
    //             }

    //             task.emit("response", {
    //                 characterResponse: lastStep[this.name].response_metadata
    //             });

    //             return {
    //                 call_task: lastStep.call_task
    //             }
    //         } catch (err) {
    //             this.logger.error(String(err));
    //             task.emit("response", {
    //                 characterResponse: {
    //                     reasoning: "...",
    //                     response: "遠端伺服器錯誤，請稍後嘗試...",
    //                     wordsCount: 0
    //                 }
    //             });
    //         }
    //     })


    // }


    /**
     * 建立工作流程
     */
    createWorkflow() {
        const workflow = new StateGraph(this.AgentState);

        workflow
            .addNode(Assistant.REASONING_MODE, this.genReasoning.bind(this))
            .addNode(Assistant.GENERAL_MODE, this.genResponse.bind(this))
            .addNode(Assistant.DIARY_MODE, this.writeDiary.bind(this))
            .addConditionalEdges(START, this.modeRouter.bind(this), [
                Assistant.REASONING_MODE, Assistant.GENERAL_MODE
            ])
            .addEdge(Assistant.REASONING_MODE, Assistant.GENERAL_MODE)
            .addConditionalEdges(Assistant.GENERAL_MODE, this.shouldContinue.bind(this), [Assistant.DIARY_MODE, END])
            .addEdge(Assistant.DIARY_MODE, END);

        // then assign to taskorchestrator or gen response

        return workflow;

    }
}