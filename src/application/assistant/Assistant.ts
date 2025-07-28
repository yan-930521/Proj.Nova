import { z } from 'zod';

import { TavilySearchResults } from '@langchain/community/tools/tavily_search';
import {
    AIMessage, BaseMessage, HumanMessage, MessageContent, SystemMessage, ToolMessage
} from '@langchain/core/messages';
import {
    ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate
} from '@langchain/core/prompts';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Annotation, END, messagesStateReducer, START, StateGraph } from '@langchain/langgraph';

import { ComponentContainer } from '../../ComponentContainer';
import { Character as CharacterObj, ICharacter } from '../../domain/entities/Character';
import { LevelDBDiaryRepository } from '../../frameworks/levelDB/LevelDBDiaryRepository';
import { LevelDBTaskRepository } from '../../frameworks/levelDB/LevelDBTaskRepository';
import { BaseSuperVisor } from '../../libs/base/BaseSupervisor';
import { getUid } from '../../libs/utils/string';
import { JSONOutputToolsParser } from '../Nova';
import { BASE_CHARACTER_PROMPT, ExtendDiary } from '../prompts/character';
import { getReplyfromSession, Session } from '../SessionContext';
import { Task } from '../task/Task';

export interface AssistantResponse {
    reasoning: string,
    response: string,
    wordsCount: number
}

export const AssistantState = Annotation.Root({
    input: Annotation<BaseMessage>({
        reducer: (_, action) => action,
    }),

    session: Annotation<Session>,

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
    }),

    hasImage: Annotation<boolean>({
        reducer: (_, action) => action,
        default: () => false
    })
});

export const RouterTool = new DynamicStructuredTool({
    name: "router_tool",
    description: "根據使用者輸入，決定是否需要一般對話、資訊檢索、任務建立、深度推理。",
    schema: z.object({
        next: z.enum([
            "general_chat",
            "retrieve_memory",
            "create_task",
            "deep_think"
        ])
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const RetrieveTool = new DynamicStructuredTool({
    name: "retrieve_tool",
    description: "Retrieves relevant information from internal memory or the web based on a query string.",
    schema: z.object({
        query: z.string().describe(`The query string to search for relevant information in memory or on the web.`)
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});


export const ReasoningOutputTool = new DynamicStructuredTool({
    name: "reasoning_tool",
    description: "從第一人稱視角深入思考目前情境，產生連貫且具人性的內在推理過程。",
    schema: z.object({
        reasoning: z.string().describe(`請從第一人稱視角，模擬一位普通人在現實生活中接收到輸入訊息時，所展開的完整內在思考過程。這段推理應自然且流暢，像是內心自語的形式，反映出一個人試圖理解對方語氣、動機、情緒與隱含訊息時會經歷的認知歷程。\n\n請務必讓推理內容具備下列特徵：\n1. **逐步展開的思緒**，包含不確定、懷疑、自我修正與嘗試理解對方的過程。\n2. **情感與直覺反應**，如困惑、懷疑、興奮、懷念等，而不只是理性判斷。\n3. **與自身經驗連結**，例如過去的記憶、情緒、感覺、習慣或價值觀。\n4. **篇幅足夠長（不少於 300 字）**，避免簡化為單句回應或明確結論。\n5. **避免任何工具決策或任務判斷**，這段推理並不涉及任何是否要執行任務或工具呼叫的選擇，它只是單純地模擬「如果我是對方，會怎麼思考」。\n\n這段推理應該要讓閱讀者感受到，這是一個活生生的人的腦中活動，而不是程式化的輸出。`)
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const ResponseOutputTool = new DynamicStructuredTool({
    name: "response_tool",
    description: "Generate a response in the tone of a text message",
    schema: z.object({
        response: z.string()
            .describe("Generate a response in the tone of a text message")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const CreateTask = new DynamicStructuredTool({
    name: "create_task",
    description: "創建新任務",
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
    static readonly RETRIEVE_MODE = "RETRIEVE_MODE";
    static readonly GENERAL_MODE = "GENERAL_MODE";
    static readonly DIARY_MODE = "DIARY_MODE";
    static readonly TASK_MODE = "TASK_MODE";

    // @ts-ignore
    tools: {
        tavilyTool: TavilySearchResults;
    }

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
                    model: "gpt-4o",
                });

                this.tools = {
                    tavilyTool: new TavilySearchResults({
                        maxResults: 5
                    }),

                }

                this._llm = ComponentContainer.getLLMManager().getLLM();

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
    static buildPrompt(messages: BaseMessage[]) {
        return ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(BASE_CHARACTER_PROMPT),
            ...messages,
            HumanMessagePromptTemplate.fromTemplate("輸入: \n{input}")
        ]);
    }

    /**
     * 如果訊息太多，存檔，否則終止對話
     */
    shouldContinue(state: typeof this.AgentState.State): string | typeof END {
        const { session } = state;

        const messages = session.context.messages;
        // 簡單說就是寫日記
        if (messages.length > 20) {
            return Assistant.DIARY_MODE;
        }

        return END;
    }

    clearImage(messages: BaseMessage[]) {
        return messages.map((m) => {
            // 若 content 是 string，直接回傳原訊息
            if (typeof m.content === "string") return m;

            // 若 content 是 array，過濾掉 image_url，保留 text
            if (Array.isArray(m.content)) {
                const textParts = m.content
                    .filter((c) => c.type === "text" && typeof c.text === "string")
                    .map((c) => c.type === "text" ? c.text as string : "")
                    .join();

                m.content = textParts;
            }
            return m;
        });
    }

    /**
     * 決定是否思考 / 用於快速響應
     */
    async modeRouter(state: typeof this.AgentState.State): Promise<string> {
        this.logger.debug("Mode routing...");

        const { session } = state;

        const llm = ComponentContainer.getLLMManager().getLLM();

        const result = await llm.bindTools([RouterTool], { tool_choice: RouterTool.name }).pipe(JSONOutputToolsParser).invoke(
            this.clearImage(
                this.getMessages(session)
            )
        );

        switch (result[0].args.next) {
            case "create_task":
                return Assistant.TASK_MODE;
            case "deep_think":
                return Assistant.REASONING_MODE;
            case "retrieve_memory":
                return Assistant.RETRIEVE_MODE;
            default:
                return Assistant.GENERAL_MODE;
        }
    }

    async genReasoning(state: typeof this.AgentState.State) {
        this.logger.debug("Generating Reasoning...");

        const { character, input, session } = state;

        const llm = ComponentContainer.getLLMManager().getLLM(Assistant.REASONING_MODE);

        const context = await ComponentContainer.getContextManager().getContext(session);

        const result = await Assistant.buildPrompt(this.getMessages(session))
            .pipe(llm.bindTools([ReasoningOutputTool], { tool_choice: ReasoningOutputTool.name }))
            .pipe(JSONOutputToolsParser)
            .invoke(
                Assistant.formatCharacter({
                    description: character.description,
                    personality: character.personality,
                    user: session.user,
                    rules: character.rules,
                    context,
                    input,
                }, character)
            );

        let reasoning = result[0].args.reasoning;
        let wordsCount = reasoning.length;
        this.logger.debug(`[reasoning]: ${reasoning}`);

        session.context.inputMessages.push({
            content: `[reasoning]: ${reasoning}`,
            type: 'assistant',
            images: [],
            user: session.user,
            timestamp: Date.now(),
            reply: () => { }
        });

        return {
            messages: [
                new AIMessage({
                    id: getUid(),
                    content: `[reasoning]: ${reasoning}`
                })
            ],
            response_metadata: {
                reasoning: reasoning ?? "",
                response: "",
                wordsCount: wordsCount ?? 0
            },
            session
        };
    }

    async retrieve(state: typeof this.AgentState.State) {
        this.logger.debug("Retrieve Information...");

        const { session } = state;

        const llm = ComponentContainer.getLLMManager().getLLM();

        const result = await llm.bindTools([RetrieveTool], { tool_choice: RetrieveTool.name })
            .pipe(JSONOutputToolsParser)
            .invoke(this.clearImage(this.getMessages(session))
            );

        // 從記憶庫檢索相關記憶
        const memoryCube = ComponentContainer.getMemoryCube();

        // 將檢索到的記憶組成 context
        const memoryPromise = memoryCube.search(result[0].args.query, 5, session).then((memories) => {
            return memories.length > 0
                ? memories.map((memory, idx) => `(${idx + 1}) ${memory.memory}`).join('\n')
                : "（沒有檢索到相關記憶）";
        })

        // 從網路檢索資料
        const tavilyPromise: Promise<ToolMessage> = this.tools.tavilyTool.invoke(result[0].args.query);

        const [memoryContext, tavilyResponse] = await Promise.all([
            memoryPromise,
            tavilyPromise
        ]);

        // wikiTool: WikipediaQueryRun;
        // braveTool: BraveSearch;

        session.context.inputMessages.push({
            content: `[memory]:\n${memoryContext}`,
            type: 'assistant',
            images: [],
            user: session.user,
            timestamp: Date.now(),
            reply: () => { }
        });
        session.context.inputMessages.push({
            content: `[information]:\n${tavilyResponse}`,
            type: 'assistant',
            images: [],
            user: session.user,
            timestamp: Date.now(),
            reply: () => { }
        });

        return {
            messages: [
                new AIMessage({
                    id: getUid(),
                    content: `[memory]:\n${memoryContext}`
                }),
                new AIMessage({
                    id: getUid(),
                    content: `[information]:\n${tavilyResponse.content}`
                })
            ],
            session
        };

    }

    async genResponse(state: typeof this.AgentState.State) {
        this.logger.debug("Generating Response...");

        const { character, input, session, response_metadata, hasImage } = state;

        const context = await ComponentContainer.getContextManager().getContext(session);

        let llm = hasImage ? ComponentContainer.getLLMManager().getLLM(Assistant.REASONING_MODE) : this.llm;

        let message = this.getMessages(session);
        if (!hasImage) message = this.clearImage(message);

        const result = await Assistant.buildPrompt(message)
            .pipe(llm.bindTools([ResponseOutputTool], { tool_choice: ResponseOutputTool.name }))
            .pipe(JSONOutputToolsParser)
            .invoke(
                Assistant.formatCharacter({
                    description: character.description,
                    personality: character.personality,
                    user: session.user,
                    rules: character.rules,
                    context,
                    input,
                }, character)
            )

        let response = result[0].args.response;
        let wordsCount = response.length;
        this.logger.debug(`[response]: ${response}`);

        session.context.inputMessages.push({
            content: `[response]: ${response}`,
            images: [],
            type: 'assistant',
            user: session.user,
            timestamp: Date.now(),
            reply: () => { }
        });

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

    async genTask(state: typeof this.AgentState.State) {
        this.logger.debug("Calling TaskOrchestrator...");

        const { input, session, response_metadata, character } = state;

        const llm = ComponentContainer.getLLMManager().getLLM();

        const result = await llm.bindTools([CreateTask], { tool_choice: CreateTask.name })
            .pipe(JSONOutputToolsParser)
            .invoke(this.clearImage(this.getMessages(session)));

        // console.log(response)
        let task_str = result[0].args.task;
        let wordsCount = task_str.length;
        this.logger.debug(`[task]: ${task_str}`);

        const task = new Task({
            user: session.user,
            userInput: JSON.stringify(input.content),
            description: task_str
        });

        setTimeout(() => task.forceExit.abort(), 60000 * 6);
        await LevelDBTaskRepository.getInstance().create(task);
        ComponentContainer.getNova().emit("taskCreate", task, session);

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

        const { character, session } = state;

        const llm = ComponentContainer.getLLMManager().getLLM();

        const context = await ComponentContainer.getContextManager().getContext(session);

        const response = await Assistant.buildPrompt(this.clearImage(this.getMessages(session))).pipe(llm).invoke(
            Assistant.formatCharacter({
                description: character.description,
                personality: character.personality,
                user: session.user,
                rules: character.rules,
                context,
                input: ExtendDiary,
            }, character)
        );

        // 保留最後10則訊息
        session.context.messages = session.context.messages.slice(-10);

        // 更新日記
        await LevelDBDiaryRepository.getInstance().update(
            new Date().toLocaleDateString(),
            String(response.content)
        );

        this.logger.debug(`[diary]: ${response.content}`);

        // return { messages: deleteMessages };
    }

    async handleMessageDispatch(session: Session) {
        session.isReplying = true;
        // multi chat todo
        let inputs: MessageContent[] = [];
        let imagesFlag: boolean = false;

        session.context.inputMessages.forEach((m) => {
            if (m.type == 'user') {
                inputs.push(`[${m.user.name}]: ${m.content}`);
                if (m.images.length > 0) imagesFlag = true;
            }
        });

        // sort
        session.context.messages = session.context.messages.sort((a, b) => a.timestamp - b.timestamp);

        // 更新中期記憶
        const cube = ComponentContainer.getMemoryCube();
        session.context.memories = (await cube.getWorkingMemory(session)).map((n) => n.memory);

        const defatultCharacter = await CharacterObj.getDefaultCharacter();

        const threadConfig = {
            configurable: { thread_id: session.id }
        };

        const stream = await this.graph.stream(
            {
                input: inputs.join("\n"),
                character: defatultCharacter,
                session,
                hasImage: imagesFlag
            },
            threadConfig
        );

        // 上一輪的合併進去 messages儲存
        session.context.messages.push(...session.context.inputMessages);
        session.context.recentMessages.push(...session.context.inputMessages);
        session.context.inputMessages = [];

        let reply = getReplyfromSession(session);

        try {
            let lastStep = null;
            for await (const step of stream) {
                if (step[Assistant.GENERAL_MODE]) {
                    if (reply) reply({
                        assistant: step[Assistant.GENERAL_MODE].response_metadata
                    });
                }
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
        } finally {
            session.isReplying = false;
        }
    }

    getTimeDetail(timestamp: number) {
        let d = new Date(timestamp);
        return `[${d.toLocaleString()}]`;
    }

    getMessages(session: Session): BaseMessage[] {
        // 目前session只能來自特定用戶 待改
        // 舊的訊息不需要image
        let removeImageMessages: BaseMessage[] = session.context.messages
            .slice(session.context.messages.length - 20)
            .map((m) => {
                if (m.type == "assistant") return new AIMessage({
                    content: `${this.getTimeDetail(m.timestamp)}: ${m.content}`
                });
                else return new HumanMessage(`${this.getTimeDetail(m.timestamp)} ${m.user.name}: ${m.content}`);
            });

        let newMessage: BaseMessage[] = session.context.inputMessages.map((m) => {
            if (m.images.length == 0) {
                if (m.type == "assistant") return new AIMessage({
                    content: `${this.getTimeDetail(m.timestamp)}: ${m.content}`
                });
                else return new HumanMessage({
                    content: `${this.getTimeDetail(m.timestamp)} ${m.user.name}: ${m.content}`
                });
            }
            let imgs = m.images.map((c) => {
                return {
                    type: "image_url",
                    image_url: { url: c },
                };
            });
            let msg = {
                content: [
                    {
                        type: "text",
                        text: `${this.getTimeDetail(m.timestamp)} ${m.type == "assistant" ? "" : m.user.name}: ${m.content}`
                    },
                    ...imgs
                ]
            }
            if (m.type == "assistant") return new AIMessage( msg);
            else return new HumanMessage(msg);
        });

        return removeImageMessages.concat(newMessage).map((m) => {
            return m;
        });
    }


    /**
     * 建立工作流程
     */
    createWorkflow() {
        const workflow = new StateGraph(this.AgentState);

        workflow
            .addNode(Assistant.GENERAL_MODE, this.genResponse.bind(this))
            .addNode(Assistant.TASK_MODE, this.genTask.bind(this))
            .addNode(Assistant.REASONING_MODE, this.genReasoning.bind(this))
            .addNode(Assistant.RETRIEVE_MODE, this.retrieve.bind(this))
            .addNode(Assistant.DIARY_MODE, this.writeDiary.bind(this))
            .addConditionalEdges(START, this.modeRouter.bind(this), [
                Assistant.GENERAL_MODE,
                Assistant.TASK_MODE,
                Assistant.REASONING_MODE,
                Assistant.RETRIEVE_MODE,
            ])
            .addEdge(Assistant.TASK_MODE, END)
            .addEdge(Assistant.REASONING_MODE, Assistant.GENERAL_MODE)
            .addEdge(Assistant.RETRIEVE_MODE, Assistant.GENERAL_MODE)
            .addConditionalEdges(Assistant.GENERAL_MODE, this.shouldContinue.bind(this), [Assistant.DIARY_MODE, END])
            .addEdge(Assistant.DIARY_MODE, END);

        // then assign to taskorchestrator or gen response

        return workflow;

    }
}