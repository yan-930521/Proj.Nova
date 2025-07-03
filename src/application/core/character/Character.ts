import { z } from 'zod';

import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { JsonMarkdownStructuredOutputParser } from '@langchain/core/output_parsers';
import {
    ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate
} from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import {
    Annotation, END, MemorySaver, messagesStateReducer, START, StateGraph
} from '@langchain/langgraph';

import { BaseState, JSONOutputToolsParser } from '../';
import { ComponentContainer } from '../../../ComponentContainer';
import { Character as CharacterObj, ICharacter } from '../../../domain/entities/Character';
import { User } from '../../../domain/entities/User';
import { LevelDBDiaryRepository } from '../../../frameworks/levelDB/LevelDBDiaryRepository';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../../../libs/base/BaseSupervisor';
import { getUid } from '../../../libs/utils/string';
import { CharacterTemplate } from '../prompts/character';
import { DiaryWriter } from './DiaryWriter';

export interface CharacterResponse {
    reasoning: string,
    response: string,
    wordsCount: number
}

export const CharacterState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    input: Annotation<string>({
        reducer: (_, action) => action,
        default: () => "",
    }),

    task: Annotation<string>({
        reducer: (_, action) => action,
        default: () => "",
    }),

    /**
     * 追加記憶
     */
    memories: Annotation<string>({
        reducer: (_, action) => action,
        default: () => "",
    }),

    /**
     * 用於總結當前對話的記憶
     */
    diary: Annotation<string>({
        reducer: (_, action) => action,
        default: () => "",
    }),

    /**
     * 用於暫存回應
     */
    response_metadata: Annotation<CharacterResponse>({
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

    user: Annotation<User>({
        reducer: (_, action) => action
    }),
});

export const OutputTool = new DynamicStructuredTool({
    name: "reasoning_tool",
    description: "reasoning and then respond",
    schema: z.object({
        reasoning: z.string()
            .describe("從第一人稱視角分析，並且推理當前情況。"),
        response: z.string()
            .describe("Generate a response based on reasoning in the tone of a text message")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
})

export class Character extends BaseSuperVisor {
    AgentState = CharacterState;

    constructor(options?: BaseSuperVisorCallOptions) {
        super({
            name: "Character",
            ...options
        });
    }

    initLogic(): Promise<void> {
        return new Promise(async (res, rej) => {
            try {
                this._llm = ComponentContainer.getLLMManager().getLLM();
                this._prompt = Character.loadPrompt();

                this.members = {
                    diaryWriter: new DiaryWriter<typeof this.AgentState.State>({
                        llm: this.llm
                    }),
                    // ruleChecker
                }

                await this.loadMembers();

                this._chain = this.prompt.pipe(this.llm.bindTools([OutputTool], {
                    tool_choice: OutputTool.name
                }));

                this.node = async (state: typeof this.AgentState.State) => {
                    this.logger.info("Generating Response...");

                    const { diary, messages, character, input, user, task, memories } = state;

                    const response = await this.chain.invoke(
                        Character.formatCharacter({
                            description: character.description,
                            personality: character.personality,
                            user,
                            userInfo: user.toString(),
                            memories: memories,
                            task,
                            rules: character.rules,
                            context: Character.createContext(),
                            diary,
                            messages,
                            input,
                        }, character)
                    );
                    try {
                        // console.log(response)
                        const data = await JSONOutputToolsParser.invoke(response);
                        let wordsCount = Object.values(data[0].args).join().length;
                        this.logger.info(`[reasoning]: ${data[0].args.reasoning}`);
                        this.logger.info(`[response]: ${data[0].args.response}`);

                        return {
                            messages: [
                                new HumanMessage({
                                    id: getUid(),
                                    content: input
                                }),
                                new AIMessage({
                                    id: getUid(),
                                    content: `[reasoning]: ${data[0].args.reasoning}\n[response]: ${data[0].args.response}`
                                })
                            ],
                            response_metadata: {
                                reasoning: data[0].args.reasoning ?? "",
                                response: data[0].args.response ?? "",
                                wordsCount: wordsCount ?? 0
                            }
                        };
                    } catch (err) {
                    }
                }

                this.graph = this.createWorkflow().compile({
                    checkpointer: new MemorySaver()
                });

                res();
            } catch (err) {
                rej(this.handleError(err));
            }
        })
    }

    node(state: typeof this.AgentState.State): Promise<any> {
        throw new Error('Method not implemented.');
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

    static createContext() {
        return [
            `現在時間: ${new Date().toLocaleString()}`
        ]
    }

    /**
     * 載入prompt
     */
    static loadPrompt() {
        return ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(CharacterTemplate),
            HumanMessagePromptTemplate.fromTemplate("{input}")
        ]);// .replace(new RegExp("{{char}}", 'g'), charactor.name)
    }


    /**
     * 如果訊息太多，存檔，否則終止對話
     */
    shouldContinue(state: typeof this.AgentState.State): string | typeof END {
        const messages = state.messages;
        // 簡單說就是寫日記

        if (messages.length == 4 || messages.length > 12) {
            return this.members.diaryWriter.name;
        }

        // if (messages.length > 4) {
        //     return this.members.memory.name;
        // }

        return END;
    }

    async processState(state: typeof BaseState.State, config: RunnableConfig): Promise<any> {
        this.logger.debug("start")

        const defatultCharacter = await CharacterObj.getDefaultCharacter();

        const task = state.task;

        const threadConfig = {
            configurable: { thread_id: task.author.id }
        };

        let date = new Date().toLocaleDateString();
        let diary = await LevelDBDiaryRepository.getInstance().findById(date);
        if (!diary) {
            diary = `${date}\n喚醒時間: ${new Date().toLocaleTimeString()}\n今天還沒跟{{user}}進行任何談話。`;
            let bool = await LevelDBDiaryRepository.getInstance().create(
                date,
                diary
            );
        }

        let task_str = task.final_report != "" ? `任務: ${task.description}\n執行結果: \n${task.final_report}` : ``

        const stream = await this.graph.stream(
            {
                input: task.userInput,
                task: task_str,
                memories: state.memories,
                character: defatultCharacter,
                diary: diary ?? "",
                user: task.author
            },
            threadConfig
        );

        try {
            let lastStep;
            for await (const step of stream) {
                if (step[this.name]) lastStep = step;
            }

            task.emit("response", {
                characterResponse: lastStep[this.name].response_metadata
            });
        } catch (err) {
            this.logger.error(String(err));
            task.emit("response", {
                characterResponse: {
                    reasoning: "...",
                    response: "遠端伺服器錯誤，請稍後嘗試...",
                    wordsCount: 0
                }
            });
        }
    }


    /**
     * @override
     */
    createWorkflow() {
        const workflow = new StateGraph(this.AgentState);

        workflow.addNode(this.name, this.node.bind(this))
            .addNode(this.members.diaryWriter.name, this.members.diaryWriter.node)
            .addEdge(START, this.name)
            .addEdge(this.members.diaryWriter.name, END);

        workflow.addConditionalEdges(this.name as typeof START, this.shouldContinue.bind(this));

        return workflow;

    }
}