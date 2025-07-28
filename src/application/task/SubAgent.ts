import { z } from 'zod';

import { TavilySearchResults } from '@langchain/community/tools/tavily_search';
import { WolframAlphaTool } from '@langchain/community/tools/wolframalpha';
import {
    AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage
} from '@langchain/core/messages';
import { JsonMarkdownStructuredOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts';
import {
    Runnable, RunnableConfig, RunnablePassthrough, RunnableSequence
} from '@langchain/core/runnables';
import { DynamicStructuredTool, DynamicTool, Tool, tool } from '@langchain/core/tools';
import { Annotation, END, Send, START, StateGraph, StateType, task } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

import { ComponentContainer } from '../../ComponentContainer';
import { BaseAgent } from '../../libs/base/BaseAgent';
import { BaseSuperVisor } from '../../libs/base/BaseSupervisor';
import { restoreTripleQuotesInObject } from '../../libs/utils/string';
import { Assistant } from '../assistant/Assistant';
import { JSONOutputToolsParser } from '../Nova';
import { SUBAGENT_PROMPT, SUBAGENT_REFLECT_PROMPT, SUBAGENT_REFLECT_TYPE } from '../prompts/task';
import { webFetchTool } from '../tools/downloadFile';
import { readDirTool, readFileTool, writeFileTool } from '../tools/file';
import { Task } from './Task';

export const SubAgentState = Annotation.Root({
    task: Annotation<Task>,
    messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),
    reflection: Annotation<string | null>({
        reducer: (_, action) => action,
        default: () => null,
    }),
    is_complete: Annotation<boolean>({
        reducer: (_, action) => action,
        default: () => false,
    }),
    should_abort: Annotation<boolean>({
        reducer: (_, action) => action,
        default: () => false,
    }),
    previous_report: Annotation<string | null>({
        reducer: (_, action) => action,
        default: () => "",
    }),
    final_report: Annotation<string | null>({
        reducer: (_, action) => action,
        default: () => null,
    }),
});

export const ReflectTool = new DynamicStructuredTool({
    name: "reflect_tool",
    description: "reflect the subtasks",
    schema: SUBAGENT_REFLECT_TYPE,
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export class SubAgent extends BaseSuperVisor {
    AgentState = SubAgentState;

    tools: (DynamicStructuredTool<any> | Tool)[] = [
        readFileTool, writeFileTool, readDirTool, webFetchTool
    ];

    // @ts-ignore
    chains: {
        executor: Runnable<any, AIMessageChunk>,
        reflector: Runnable<any, { type: string; args: Record<string, string>; id: string; }[]>
    } = {}

    constructor() {
        super({
            name: "SubAgent"
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = await ComponentContainer.getLLMManager().create(this.name, {
            model: "gpt-4o-mini",
            temperature: 0.2,
            maxTokens: 8192
        });

        this.chains.executor = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(SUBAGENT_PROMPT)
        ]).pipe(this.llm.bindTools(this.tools))

        this.chains.reflector = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(SUBAGENT_REFLECT_PROMPT)
        ]).pipe(this.llm.bindTools([ReflectTool], {
            tool_choice: ReflectTool.name
        })).pipe(JSONOutputToolsParser)

        const tavilyTool = new TavilySearchResults({
            maxResults: 4
        });

        this.tools.push(tavilyTool);

        this._graph = this.createWorkflow().compile();
    }

    async processTasks(previousReport: string, tasks: Task[]): Promise<Task[]> {
        return new Promise(async (res) => {
            // 這邊的task是並行安全的，且每個task都是獨立的
            this.logger.debug("\nProcess Step: " + tasks[0].userInput);

            try {
                const result = await Promise.all(
                    tasks.map(async (task) => await this.handleTask(previousReport, task))
                );

                res(result);
            } catch (err) {
                // 基本上不會有錯誤才對
                this.logger.error("Error processing tasks:" + String(err));
                res(tasks.map((task) => {
                    task.final_report += "\n" + String(err);
                    return task;
                }))
            }
        })
    }

    async handleTask(previousReport: string, task: Task): Promise<Task> {
        return new Promise(async (res) => {
            try {
                const stream = await this.graph.stream({
                    previous_report: previousReport,
                    task
                });

                let lastStep = null;

                for await (const step of stream) {
                    lastStep = step;
                }

                if (lastStep && lastStep.is_complete) {
                    task.isComplete = true;
                    task.final_report = lastStep.final_report;
                }

                if (lastStep && lastStep.should_abort) {
                    task.isComplete = false;
                    task.final_report = lastStep.reflection;
                }

                task.final_report = restoreTripleQuotesInObject(task.final_report);

                this.logger.debug(`\n${task.isComplete ? "✅" : "❌"} - ${task.description}`);

                if (!task.isComplete) console.warn(lastStep);

                res(task);
            } catch (err) {
                this.logger.error("Error processing task:" + String(err));
                task.isComplete = false;
                task.final_report = String(err);
                res(task)
            }
        })
    }

    async execute(state: typeof SubAgentState.State) {
        const messages = state.reflection == null ? state.messages : [
            ...state.messages,
            new HumanMessage(state.reflection)
        ];

        const message = await this.chains.executor.invoke({
            previous_report: state.previous_report,
            task: state.task.description,
            messages
        });

        const result = await JSONOutputToolsParser.invoke(message);

        // console.log(message)

        const toolMsgs: BaseMessage[] = [];
        for (const t of result) {
            if (t.type && t.args) {
                const tool = this.tools.find(tool => tool.name === t.type);
                if (tool && typeof tool.invoke === "function") {
                    try {
                        const toolResult = await tool.invoke(t.args);
                        toolMsgs.push(new AIMessage(`Tool ${t.type} result: ${JSON.stringify(toolResult)}`));
                    } catch (err) {
                        toolMsgs.push(new AIMessage(`Error calling tool ${t.type}: ${String(err)}`));
                    }
                } else {
                    toolMsgs.push(new AIMessage(`Tool ${t.type} not found.`));
                }
            }
        }

        return {
            messages: [
                ...toolMsgs,
                new AIMessage(message)
            ]
        }
    }

    async reflect(state: typeof SubAgentState.State) {
        if (state.messages.length > 6) {
            return {
                is_complete: false,
                should_abort: true,
                reflection: "Too many attempts without success.",
                final_report: "Too many attempts without success."
            }
        }

        const assistantOutput = state.messages
            .filter((m) => m.getType() === "ai")            // 只保留 AIMessage
            .map((m) => m.content)                          // 取出 content
            .join("\n\n---\n\n");                           // 用分隔線串起來

        try {
            const result = await this.chains.reflector.invoke({
                task: state.task.description,
                messages: assistantOutput
            })

            return {
                is_complete: result[0].args.is_complete,
                should_abort: result[0].args.should_abort,
                reflection: result[0].args.description,
                final_report: result[0].args.final_report
            }
        } catch (err) {
            return {
                is_complete: false,
                should_abort: true,
                reflection: String(err),
                final_report: String(err)
            }
        }
    }

    async shouldContinue(state: typeof SubAgentState.State) {
        const {
            is_complete,
            should_abort
        } = state;

        if (is_complete || should_abort) {
            return END;
        }

        return "execute";
    }

    /**
     * 建立工作流程
     */
    createWorkflow() {
        const workflow = new StateGraph(this.AgentState);
        workflow
            .addNode("execute", this.execute.bind(this))
            .addNode("reflect", this.reflect.bind(this))
            .addEdge(START, "execute")
            .addEdge("execute", "reflect")
            .addConditionalEdges("reflect", this.shouldContinue.bind(this))

        // then assign to taskorchestrator or gen response

        return workflow;

    }
}