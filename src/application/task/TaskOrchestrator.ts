import { z } from 'zod';

import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import {
    _INTERNAL_ANNOTATION_ROOT, Annotation, END, MemorySaver, messagesStateReducer, Send, START,
    StateDefinition, StateGraph, task, UpdateType
} from '@langchain/langgraph';
import { ChatOpenAI, ChatOpenAICallOptions } from '@langchain/openai';

import { ComponentContainer } from '../../ComponentContainer';
import { LevelDBTaskRepository } from '../../frameworks/levelDB/LevelDBTaskRepository';
import { BaseAgent, BaseAgentCallOptions } from '../../libs/base/BaseAgent';
import { BaseSuperVisor } from '../../libs/base/BaseSupervisor';
import { JSONOutputToolsParser, Nova } from '../Nova';
import { PersonaResponse } from '../persona/Persona';
import {
    CLOSED_BOOK_PROMPT, CLOSED_BOOK_TYPE, GET_FINAL_ANSWER_PROMPT, PARALLEL_SAFE_DECOMPOSER_PROMPT,
    PARALLEL_SAFE_DECOMPOSER_TYPE, SYNTHESIZE_PROMPT, SYSTEM_MESSAGE
} from '../prompts/task';
import { getReplyfromSession, Session } from '../SessionContext';
import { CreateTask } from '../tools/system';
import { SubAgent } from './SubAgent';
import { Task, TaskResponse } from './Task';

/**
 * 基於lats理論的任務規劃
 */
export class TaskOrchestrator extends BaseSuperVisor {
    public teamDescription: string = "";
    private defaultMessages: BaseMessage[] = [new SystemMessage(SYSTEM_MESSAGE)];

    public subAgent = new SubAgent();

    runingTasks: Record<string, boolean> = {}

    constructor(options: BaseAgentCallOptions = {}) {
        super({
            name: options.name ?? "TaskOrchestrator",
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = await ComponentContainer.getLLMManager().create(this.name, {
            model: "gpt-4o-mini",
            temperature: 0.2,
            maxTokens: 8192
        });

        await this.subAgent.init();
    }

    async handleTask(input: string, session: Session) {
        let reply = getReplyfromSession(session);

        try {
            this.logger.debug("Creating Task...");
            const result = await this.llm.bindTools([CreateTask], { tool_choice: CreateTask.name })
                .pipe(JSONOutputToolsParser)
                .invoke(Nova.clearImage(Nova.getMessages(session)));

            let task_str = result[0].args.task;
            this.logger.debug(`[task]: ${task_str}`);

            const task = new Task({
                user: session.user,
                userInput: input,
                description: task_str
            });

            session.context.inputMessages.push({
                content: `[task]: ${task_str}`,
                images: [],
                type: 'assistant',
                user: session.user,
                timestamp: Date.now(),
                reply: () => { }
            });

            setTimeout(() => task.forceExit.abort(), 60000 * 6);
            await LevelDBTaskRepository.getInstance().create(task);
            ComponentContainer.getNova().emit("taskCreate", task, session);

        } catch (err) {
            this.logger.error(String(err));
            if (reply) reply({
                persona: {
                    reasoning: "...",
                    response: "Task 模組故障，請稍後嘗試...",
                    wordsCount: 0
                }
            });
        }
    }

    async processTask(task: Task, session: Session) {
        let reply = getReplyfromSession(session);
        this.logger.debug("\nProcess Task: " + task.description);
        const subTasks = await this.decomposeTask(task, session);

        let previousReport = `Request:\n${task.description}\n\n`;

        for (const stepIndex in subTasks) {
            // 把這個step的所有子任務 總結
            const tasks = subTasks[stepIndex];
            const result = await this.subAgent.processTasks(previousReport, tasks);
            const allCompleted = tasks.every(t => t.isComplete);
            const report = tasks
                .map(t => `${t.description}\n  - Completed: ${t.isComplete ? "PASS" : "FAILED"}: \nSummary:\n${t.final_report}`)
                .join("\n");
            const output = `Step [${Number(stepIndex) + 1}]\nAll Completed: ${allCompleted ? "TRUE" : "FALSE"}\n\n${report}\n\n`;
            previousReport += output;
            this.logger.debug(`\n${allCompleted ? "✅" : "❌"} - Step [${Number(stepIndex) + 1}] - ${tasks[0].userInput}`);
            if (reply) reply({
                task: {
                    sender: 'Process Step',
                    instruction: '',
                    message: `${allCompleted ? "✅" : "❌"} - Step [${Number(stepIndex) + 1}] - ${tasks[0].userInput}`
                }
            })
        }

        task.final_report = await this.prepareFinalAnswer(task, previousReport);
    }

    async decomposeTask(task: Task, session: Session) {
        this.logger.debug("Decomposing Task");


        let reply = getReplyfromSession(session);

        // create sub task

        const planning_conversation: BaseMessage[] = [];

        // 1. GATHER FACTS
        // create a closed book task and generate a response and update the chat history
        planning_conversation.push(
            new HumanMessage(this.getClosedBookPrompt(task.description))
        )

        const facts = await this.llm.withStructuredOutput(CLOSED_BOOK_TYPE).invoke(this.defaultMessages.concat(planning_conversation));
        const fact_str = TaskOrchestrator.formatFacts(facts);
        this.logger.debug("\n" + fact_str);
        planning_conversation.push(new AIMessage(fact_str));

        // 2. CREATE A PLAN
        // plan based on available information
        planning_conversation.push(
            new HumanMessage(this.getDecomposerPrompt())
        )

        const plan = await this.llm.withStructuredOutput(PARALLEL_SAFE_DECOMPOSER_TYPE).invoke(this.defaultMessages.concat(planning_conversation))


        const plan_str = plan.steps
            .map((step, i) => {
                const subtasksStr = step.subtasks
                    .map((subtask, j) =>
                        `    Subtask [${j + 1}]\n` +
                        `      - Objective      : ${subtask.objective}\n` +
                        `      - Expected Output: ${subtask.expected_output}`
                    )
                    .join("\n");

                return `Step [${i + 1}]: ${step.summary}\n${subtasksStr}`;
            })
            .join("\n\n");

        // this.logger.debug("\n" + plan_str);
        if (reply) reply({
            task: {
                sender: 'Decomposing Task',
                instruction: '',
                message: plan_str
            }
        });

        const tasks = plan.steps.map((step, i) =>
            step.subtasks.map((subtask, j) =>
                new Task({
                    user: session.user,
                    userInput: step.summary,
                    description:
                        `Subtask [${j + 1}]\n` +
                        `  - Objective      : ${subtask.objective}\n` +
                        `  - Expected Output: ${subtask.expected_output}`
                })
            )
        );

        return tasks;
    }

    async prepareFinalAnswer(task: Task, report: string) {
        const final_answer = await
            ChatPromptTemplate.fromMessages([
                new SystemMessage(this.getFinalAnswerPrompt(task.description, report))
            ]).pipe(this.llm).invoke({});

        this.logger.debug(`Final Report:\n${final_answer.content.toString()}`);

        return final_answer.content.toString();
    }

    private static formatFacts(facts: z.infer<typeof CLOSED_BOOK_TYPE>) {
        return Object.keys(facts).map((member) => {
            let name = member.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") // remove underscores
            return `${name}: \n` + facts[member as keyof typeof facts].map((f) => `    - ${f}`).join("\n");
        }).join("\n")
    }

    private getClosedBookPrompt(task: string): string {
        return CLOSED_BOOK_PROMPT.replace("{task}", task);
    }

    private getDecomposerPrompt(): string {
        return PARALLEL_SAFE_DECOMPOSER_PROMPT;
    }

    private getSynthesizePrompt(task: string, facts: string, plan: string): string {
        return SYNTHESIZE_PROMPT
            .replace("{task}", task)
            .replace("{facts}", facts)
            .replace("{plan}", plan);
    }

    private getFinalAnswerPrompt(task: string, report: string): string {
        return GET_FINAL_ANSWER_PROMPT
            .replace("{task}", task)
            .replace("{report}", report);
    }
}