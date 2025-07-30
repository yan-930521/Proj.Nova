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
import { JSONOutputToolsParser, Nova } from '../Nova';
import { BASE_CHARACTER_PROMPT, ExtendDiary } from '../prompts/character';
import { getReplyfromSession, Session } from '../SessionContext';
import { Task } from '../task/Task';
import {
    CreateTask, ReasoningOutputTool, ResponseOutputTool, RetrieveTool, RouterTool
} from '../tools/system';

export interface PersonaResponse {
    reasoning: string,
    response: string,
    wordsCount: number
}

export const PersonaState = Annotation.Root({
    input: Annotation<BaseMessage>({
        reducer: (_, action) => action,
    }),

    session: Annotation<Session>,

    /**
     * 用於暫存回應
     */
    response_metadata: Annotation<PersonaResponse>({
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

/**
 * 負責與用戶交互的代理人
 */
export class Persona extends BaseSuperVisor {
    AgentState = PersonaState;

    static readonly REASONING_MODE = "REASONING_MODE";
    static readonly RETRIEVE_MODE = "RETRIEVE_MODE";
    static readonly GENERAL_MODE = "GENERAL_MODE";
    static readonly DIARY_MODE = "DIARY_MODE";

    // @ts-ignore
    tools: {
        tavilyTool: TavilySearchResults;
    }

    constructor() {
        super({
            name: "Persona"
        });
    }

    initLogic(): Promise<void> {
        return new Promise(async (res, rej) => {
            try {
                ComponentContainer.getLLMManager().create(Persona.REASONING_MODE, {
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
            return Persona.DIARY_MODE;
        }

        return END;
    }

    /**
     * 決定是否思考 / 用於快速響應
     */
    async modeRouter(state: typeof this.AgentState.State): Promise<string> {
        this.logger.debug("Mode routing...");

        const { session } = state;

        const llm = ComponentContainer.getLLMManager().getLLM();

        const result = await llm.bindTools([RouterTool], { tool_choice: RouterTool.name }).pipe(JSONOutputToolsParser).invoke(
            Nova.clearImage(
                Nova.getMessages(session)
            )
        );

        switch (result[0].args.next) {
            case "deep_think":
                return Persona.REASONING_MODE;
            case "retrieve_memory":
                return Persona.RETRIEVE_MODE;
            default:
                return Persona.GENERAL_MODE;
        }
    }

    async genReasoning(state: typeof this.AgentState.State) {
        this.logger.debug("Generating Reasoning...");

        const { character, input, session } = state;

        const llm = ComponentContainer.getLLMManager().getLLM(Persona.REASONING_MODE);

        const context = await ComponentContainer.getContextManager().getContext(session);

        const result = await Persona.buildPrompt(Nova.getMessages(session))
            .pipe(llm.bindTools([ReasoningOutputTool], { tool_choice: ReasoningOutputTool.name }))
            .pipe(JSONOutputToolsParser)
            .invoke(
                Persona.formatCharacter({
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
            .invoke(Nova.clearImage(Nova.getMessages(session))
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

        let llm = hasImage ? ComponentContainer.getLLMManager().getLLM(Persona.REASONING_MODE) : this.llm;

        let message = Nova.getMessages(session);
        if (!hasImage) message = Nova.clearImage(message);

        const result = await Persona.buildPrompt(message)
            .pipe(llm.bindTools([ResponseOutputTool], { tool_choice: ResponseOutputTool.name }))
            .pipe(JSONOutputToolsParser)
            .invoke(
                Persona.formatCharacter({
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

    async writeDiary(state: typeof this.AgentState.State) {
        this.logger.debug("Writing Diary...");

        const { character, session } = state;

        const llm = ComponentContainer.getLLMManager().getLLM();

        const context = await ComponentContainer.getContextManager().getContext(session);

        const response = await Persona.buildPrompt(Nova.clearImage(Nova.getMessages(session))).pipe(llm).invoke(
            Persona.formatCharacter({
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

    async handleChat(input: string, hasImage: boolean, character: CharacterObj, session: Session) {
        let reply = getReplyfromSession(session);
        
        try {
            const threadConfig = {
                configurable: { thread_id: session.id }
            };

            const stream = await this.graph.stream(
                {
                    input,
                    character: character,
                    session,
                    hasImage
                },
                threadConfig
            );

            for await (const step of stream) {
                if (step[Persona.GENERAL_MODE]) {
                    if (reply) reply({
                        persona: step[Persona.GENERAL_MODE].response_metadata
                    });
                }
            }
        } catch (err) {
            this.logger.error(String(err));
            if (reply) reply({
                persona: {
                    reasoning: "...",
                    response: "Persona 模組故障，請稍後嘗試...",
                    wordsCount: 0
                }
            });
        }
    }


    /**
     * 建立工作流程
     */
    createWorkflow() {
        const workflow = new StateGraph(this.AgentState);

        workflow
            .addNode(Persona.GENERAL_MODE, this.genResponse.bind(this))
            .addNode(Persona.REASONING_MODE, this.genReasoning.bind(this))
            .addNode(Persona.RETRIEVE_MODE, this.retrieve.bind(this))
            .addNode(Persona.DIARY_MODE, this.writeDiary.bind(this))
            .addConditionalEdges(START, this.modeRouter.bind(this), [
                Persona.GENERAL_MODE,
                Persona.REASONING_MODE,
                Persona.RETRIEVE_MODE,
            ])
            .addEdge(Persona.REASONING_MODE, Persona.GENERAL_MODE)
            .addEdge(Persona.RETRIEVE_MODE, Persona.GENERAL_MODE)
            .addConditionalEdges(Persona.GENERAL_MODE, this.shouldContinue.bind(this), [Persona.DIARY_MODE, END])
            .addEdge(Persona.DIARY_MODE, END);

        // then assign to taskorchestrator or gen response

        return workflow;

    }
}