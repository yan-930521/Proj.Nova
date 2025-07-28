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
import { BaseAgent, BaseAgentCallOptions } from '../../libs/base/BaseAgent';
import { BaseSuperVisor } from '../../libs/base/BaseSupervisor';
import { AssistantResponse } from '../assistant/Assistant';
import {
    CLOSED_BOOK_PROMPT, CLOSED_BOOK_TYPE, GET_FINAL_ANSWER_PROMPT, PARALLEL_SAFE_DECOMPOSER_PROMPT,
    PARALLEL_SAFE_DECOMPOSER_TYPE, SYNTHESIZE_PROMPT, SYSTEM_MESSAGE
} from '../prompts/task';
import { getReplyfromSession, Session } from '../SessionContext';
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

    // async selectNextAgent(state: typeof TaskOrchestratorState.State) {
    //     this.logger.debug("select next agent");
    //     this.logger.debug("remain steps: " + state.task_plan.length);

    //     let {
    //         replan_counter,
    //         stall_counter,
    //         session
    //     } = state;
    //     // Orchestrate the next step
    //     const ledger_data = await this.updateLedger(state);

    //     // Task is complete
    //     if (ledger_data.is_request_satisfied.answer) {
    //         this.logger.debug("request satisfied");

    //         if (state.final_report == "") {
    //             // generate a final message to summarize the conversation
    //             state.final_report = await this.prepareFinalAnswer(state);
    //         }

    //         state.task.final_report = state.final_report;

    //         return END;
    //     }
    //     // console.log(state.messages.length)
    //     // Stalled or stuck in a loop
    //     if (ledger_data.is_in_loop.answer || !ledger_data.is_progress_being_made.answer) {
    //         stall_counter++;
    //         this.logger.debug("stall: " + stall_counter)
    //         if (stall_counter > TaskOrchestrator.MAX_STALL_BEFORE_REPLAN) {
    //             this.logger.debug("replan: " + replan_counter)
    //             replan_counter++;
    //             stall_counter = 0;
    //             if (replan_counter > TaskOrchestrator.MAX_REPLAN) {
    //                 replan_counter = 0;
    //                 stall_counter = 0;
    //                 this.logger.debug("Replan counter exceeded... Terminating.");
    //                 return END;
    //             } else {
    //                 //  Let's create a new plan
    //                 return "UpdateFactAndPlan";
    //             }
    //         }
    //     }

    //     // If we goit this far, we were not starting, done, or stuck


    //     let next_agent = state.task_plan.shift(); // get the first plan step
    //     if (!next_agent) return "UpdateFactAndPlan";

    //     // find the agent with plan
    //     for (let name in this.members) {
    //         if (name.toLowerCase() == next_agent[0].toLowerCase()) {
    //             let instruction = next_agent[1];
    //             return new Send(name, { ...state, instruction });
    //         }
    //     }

    //     return END;
    // }

    // async handleTaskCreate(session: Session, task: Task) {
    //     const threadConfig = {
    //         configurable: {
    //             thread_id: task.id, // 使用任務id
    //         }
    //     };

    //     let reply = getReplyfromSession(session);

    //     if (this.graph.checkpointer) {
    //         let thread = await this.graph.checkpointer.get(threadConfig);
    //         if (this.runingTasks[task.id] && thread) {
    //             this.logger.debug("update thread for task: " + task.id);
    //             await this.graph.updateState({
    //                 ...threadConfig,
    //                 signal: task.forceExit.signal
    //             }, {
    //                 messages: [new HumanMessage(task.userInput)],
    //                 task_description: task.description,
    //                 session,
    //                 task
    //             });
    //         } else {
    //             this.runingTasks[task.id] = true;
    //             this.logger.debug("create thread for task: " + task.id);
    //             const stream = await this.graph.stream(
    //                 {
    //                     messages: [new HumanMessage(task.userInput)],
    //                     task_description: task.description,
    //                     session,
    //                     task
    //                 } as Partial<typeof TaskOrchestratorState.State>,
    //                 {
    //                     ...threadConfig,
    //                     signal: task.forceExit.signal
    //                 }
    //             );

    //             let lastStep;
    //             for await (const step of stream) {
    //                 lastStep = step;
    //                 const [stepName, stepState] = Object.entries(step)[0];

    //                 if (Object.keys(this.members).includes(stepName) && (stepState as typeof TaskOrchestratorState.State).messages) {
    //                     let instruction = (stepState as typeof TaskOrchestratorState.State).messages.shift()?.content ?? "";
    //                     let msg = (stepState as typeof TaskOrchestratorState.State).messages.map((m) => m.content).join("\n");

    //                     if (reply) reply({
    //                         task: {
    //                             sender: stepName,
    //                             instruction: instruction as string,
    //                             message: msg
    //                         }
    //                     });
    //                 }

    //                 // console.log(stepName, stepState);
    //                 // // @ts-ignore
    //                 // console.log("rolled out: ", stepState?.root?.height);
    //                 // if(stepState?.messages) {

    //                 // }
    //                 this.logger.debug("---");
    //             }

    //             session.context.recentMessages.push({
    //                 content: task.final_report,
    //                 type: 'assistant',
    //                 images: [],
    //                 user: session.user,
    //                 timestamp: Date.now(),
    //                 reply: function (response: { assistant?: AssistantResponse; task?: TaskResponse; }): void {
    //                     throw new Error('Function not implemented.');
    //                 }
    //             })

    //             if (reply) reply({
    //                 task: {
    //                     sender: 'Final Report',
    //                     instruction: "",
    //                     message: task.final_report
    //                 }
    //             })
    //         }
    //     }
    // }


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