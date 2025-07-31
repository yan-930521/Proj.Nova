import { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { AIMessage, BaseMessage, HumanMessage, MessageContent } from '@langchain/core/messages';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { Runnable, RunnableConfig } from '@langchain/core/runnables';

import { ComponentContainer } from '../ComponentContainer';
import { Character } from '../domain/entities/Character';
import { LevelDBTaskRepository } from '../frameworks/levelDB/LevelDBTaskRepository';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../libs/base/BaseSupervisor';
import { replaceCodeBlocksToTripleQuotes, restoreTripleQuotesInObject } from '../libs/utils/string';
import { Persona, PersonaResponse } from './persona/Persona';
import { getReplyfromSession, Session, SessionContext } from './SessionContext';
import { LongtermTask, Task, TaskType } from './task/Task';
import { TaskOrchestrator } from './task/TaskOrchestrator';
import { FastClassify as FastClassifyTool } from './tools/system';
import { Message, UserIO } from './user/UserIO';

export const JSONOutputToolsParser = new JsonOutputToolsParser<{
    type: string,
    args: Record<string, string>,
    id: string
}[]>({ returnId: true });

export interface NovaEvents {
    "messageCreate": [Message],
    "messageDispatch": [Session],
    "taskCreate": [Task, Session],
    "longtermTaskCreate": [LongtermTask, Session]
}

export class Nova extends BaseSuperVisor<NovaEvents> {
    Persona = new Persona();
    TaskOrchestrator = new TaskOrchestrator();
    UserIO = new UserIO();
    SessionContext = new SessionContext();

    // @ts-ignore
    FastClassifier: Runnable<BaseLanguageModelInput, {
        type: string;
        args: Record<string, string>;
        id: string;
    }[], RunnableConfig<Record<string, any>>>

    constructor(options: BaseSuperVisorCallOptions = {}) {
        super({
            name: options?.name ?? "Nova"
        });
    }

    protected async initLogic(): Promise<void> {
        await this.loadMembers([this.Persona, this.TaskOrchestrator, this.UserIO, this.SessionContext]);

        this.on("messageCreate", this.UserIO.handleMessageCreate.bind(this.UserIO));
        this.on("messageDispatch", this.handleMessageDispatch.bind(this.Persona));
        this.on("taskCreate", this.TaskOrchestrator.processShorttermTask.bind(this.TaskOrchestrator));
        this.on("longtermTaskCreate", (task: LongtermTask) => {
            console.log(task)
        });

        this.FastClassifier = ComponentContainer.getLLMManager().getLLM().bindTools([FastClassifyTool], { tool_choice: FastClassifyTool.name }).pipe(JSONOutputToolsParser)

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
    * 去除訊息中的圖片
    * @param messages 
    * @returns 
    */
    static clearImage(messages: BaseMessage[]) {
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

    static getTimeDetail(timestamp: number) {
        let d = new Date(timestamp);
        return `[${d.toLocaleString()}]`;
    }

    /**
     * 將 session 內訊息轉換為 BaseMessage 陣列，舊訊息不帶圖片，inputMessages 支援圖片格式
     */
    static getMessages(session: Session): BaseMessage[] {
        // 取最近 20 則歷史訊息（不含圖片）
        const history: BaseMessage[] = session.context.messages
            .slice(-20)
            .map(m => Nova._toBaseMessage(m, false));

        // inputMessages 支援圖片
        const inputs: BaseMessage[] = session.context.inputMessages.map(m => Nova._toBaseMessage(m, true));

        return [...history, ...inputs];
    }

    /**
     * 將 Message 轉為 BaseMessage，根據是否允許圖片決定格式
     */
    private static _toBaseMessage(m: Message, allowImage: boolean): BaseMessage {
        const time = Nova.getTimeDetail(m.timestamp);
        const userPart = m.type === "assistant" ? "" : `${m.user.name}: `;
        const text = `${time} ${userPart}${m.content}`;

        if (allowImage && m.images && m.images.length > 0) {
            const imgs = m.images.map(url => ({ type: "image_url", image_url: { url } }));
            const content = [
                { type: "text", text },
                ...imgs
            ];
            return m.type === "assistant" ? new AIMessage({ content }) : new HumanMessage({ content });
        } else {
            return m.type === "assistant"
                ? new AIMessage({ content: text })
                : new HumanMessage({ content: text });
        }
    }

    async processInputs(session: Session) {
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

        return {
            input: inputs.join("\n"),
            imagesFlag
        }
    }

    async handleMessageDispatch(session: Session) {
        session.isReplying = true;
        let reply = getReplyfromSession(session);
        try {
            const { input, imagesFlag } = await this.processInputs(session);

            //  輕量級前置判斷器（Fast Classifier）

            const result = await this.FastClassifier.invoke([new HumanMessage(input)]);
            const intent = result[0].args.intent as keyof typeof TaskType;

            const defatultCharacter = await Character.getDefaultCharacter();

            switch (intent) {
                case "Shortterm":
                    // 傳給任務導向調度器處理複合任務
                    await this.TaskOrchestrator.handleShorttermTask(input, session);
                    break;
                case "Longterm":
                    // 傳給任務導向調度器處理複合任務
                    await this.TaskOrchestrator.handleLongtermTask(input, session);
                    break;
                case "CasualChat": default:
                    // 直接交給 Persona 層處理閒聊對話
                    await this.Persona.handleChat(input, imagesFlag, defatultCharacter, session);
                    break;
            }


            // 上一輪的合併進去 messages儲存
            session.context.messages.push(...session.context.inputMessages);
            session.context.recentMessages.push(...session.context.inputMessages);
            session.context.inputMessages = [];

        } catch (err) {
            this.logger.error(String(err));
            if (reply) reply({
                persona: {
                    reasoning: "...",
                    response: "遠端伺服器錯誤，請稍後嘗試...",
                    wordsCount: 0
                }
            });
        } finally {
            session.isReplying = false;
        }
    }
}