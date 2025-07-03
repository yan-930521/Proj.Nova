import { z } from 'zod';

import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import {
    _INTERNAL_ANNOTATION_ROOT, Annotation, END, MemorySaver, messagesStateReducer, Send, START,
    StateDefinition, StateGraph, task, UpdateType
} from '@langchain/langgraph';

import { ComponentContainer } from '../../ComponentContainer';
import { Task } from '../../domain/entities/Task';
import { User } from '../../domain/entities/User';
import { BaseAgentCallOptions } from '../../libs/base/BaseAgent';
import { BaseSuperVisor } from '../../libs/base/BaseSupervisor';
import { BaseState } from './';
import {
    ORCHESTRATOR_CLOSED_BOOK_PROMPT, ORCHESTRATOR_CLOSED_BOOK_TYPE, ORCHESTRATOR_GET_FINAL_ANSWER,
    ORCHESTRATOR_LEDGER_PROMPT, ORCHESTRATOR_LEDGER_TYPE, ORCHESTRATOR_PLAN_PROMPT,
    ORCHESTRATOR_PLAN_PROMPT_V2, ORCHESTRATOR_PLAN_TYPE, ORCHESTRATOR_SYNTHESIZE_PROMPT,
    ORCHESTRATOR_SYSTEM_MESSAGE, ORCHESTRATOR_UPDATE_FACTS_PROMPT, ORCHESTRATOR_UPDATE_PLAN_PROMPT,
    ORCHESTRATOR_UPDATE_PLAN_TYPE
} from './prompts/task';
import { FileManager } from './team/FileManager';
import { Researcher } from './team/Researcher';
import { WebSurfer } from './team/WebSurfer';

export const TaskOrchestratorState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    task: Annotation<Task>({
        reducer: (prev, next) => (next ?? prev),
    }),

    task_description: Annotation<string>({
        reducer: (prev, next) => (next ?? prev),
        default: () => ""
    }),

    // Task Ledger for facts, guesses, etc.
    task_ledger: Annotation<Record<string, string[]>>({
        reducer: (prev, next) => (next ?? prev),
        default: () => ({})
    }),

    // Step - by - step task plan
    task_plan: Annotation<[string, string][]>({
        reducer: (prev, next) => (next ?? prev),
        default: () => []
    }),

    replan_counter: Annotation<number>({
        reducer: (prev, next) => (next ?? prev),
        default: () => 0
    }),

    stall_counter: Annotation<number>({
        reducer: (prev, next) => (next ?? prev),
        default: () => 0
    }),

    final_report: Annotation<string>({
        reducer: (prev, next) => (next ?? prev),
        default: () => ""
    }),

    task_complete: Annotation<boolean>({
        reducer: (prev, next) => (next ?? prev),
        default: () => false
    }),

    instruction: Annotation<string>({
        reducer: (prev, next) => (next ?? prev),
        default: () => ""
    }),
});

/**
 * 基於lats理論的任務規劃
 */
export class TaskOrchestrator extends BaseSuperVisor {
    AgentState = TaskOrchestratorState;
    public teamDescription: string = "";
    private defaultMessages: BaseMessage[] = [new SystemMessage(ORCHESTRATOR_SYSTEM_MESSAGE)];
    static MAX_STALL_BEFORE_REPLAN = 3;
    static MAX_REPLAN = 3;

    runingTasks: Record<string, boolean> = {}
    constructor(options: BaseAgentCallOptions = {}) {
        super({
            name: options.name ?? "TaskOrchestrator",
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = ComponentContainer.getLLMManager().getLLM();
        await this.loadMembers([
            new WebSurfer({}),
            new FileManager({}),
            new Researcher({})
        ]);
        this.teamDescription = this.memberlist.map((member) => `${member.name}: ${member.description}\n`).join("");
        // `WebSurfer: Specialized in retrieving real-time information from the web using search engines and browsing capabilities.
        // Coder: Expert in writing, debugging, and executing code in various programming languages, including Python and JavaScript.
        // FileSurfer: Skilled in navigating and managing file systems, reading and writing files as needed.
        // UserProxy: Represents the user, providing input and feedback to guide the task execution.\n`;

        this.createGraph();

    }

    node(state: any): any {
        this.logger.debug("start")
    }

    async initializeTask(state: typeof TaskOrchestratorState.State) {
        this.logger.debug("Initialize Task");

        // Shallow-copy the conversation
        const planning_conversation: BaseMessage[] = [];
        state.messages.map((m) => planning_conversation.push(m));

        // 1. GATHER FACTS
        // create a closed book task and generate a response and update the chat history
        planning_conversation.push(
            new HumanMessage(this.getClosedBookPrompt(state.task_description))
        )

        const facts = await this.llm.withStructuredOutput(ORCHESTRATOR_CLOSED_BOOK_TYPE).invoke(this.defaultMessages.concat(planning_conversation));
        const fact_str = TaskOrchestrator.formatFacts(facts);
        this.logger.debug("\n" + fact_str);
        planning_conversation.push(new AIMessage(fact_str));

        // 2. CREATE A PLAN
        // plan based on available information
        planning_conversation.push(
            new HumanMessage(this.getPlanPrompt(this.teamDescription))
        )

        const plan = await this.llm.withStructuredOutput(ORCHESTRATOR_PLAN_TYPE).invoke(this.defaultMessages.concat(planning_conversation))
        const plans = plan.plans.map((p) => [p.agent, p.task])
        const plan_str = plans.map((p) => `${p[0]}: ${p[1]}`).join("\n");
        this.logger.debug("\n" + plan_str);

        // At this point, the planning conversation is dropped.

        return {
            replan_counter: 0,
            stall_counter: 0,
            task_ledger: facts,
            task_plan: plans,
            messages: [
                new AIMessage(this.getSynthesizePrompt(
                    state.task_description,
                    this.teamDescription,
                    fact_str,
                    plan_str
                ))
            ]
        }
    }

    async updateFactAndPlan(state: typeof TaskOrchestratorState.State) {
        this.logger.debug("update fact and plan")
        // called when the orchestrator decides to replan

        // Shallow - copy the conversation
        const planning_conversation: BaseMessage[] = [];
        state.messages.map((m) => planning_conversation.push(m));

        // Update the facts
        planning_conversation.push(
            new HumanMessage(this.getUpdateFactsPrompt(
                state.task_description,
                TaskOrchestrator.formatFacts(state.task_ledger as z.infer<typeof ORCHESTRATOR_CLOSED_BOOK_TYPE>)
            ))
        )

        const new_facts = await this.llm.withStructuredOutput(ORCHESTRATOR_CLOSED_BOOK_TYPE).invoke(this.defaultMessages.concat(planning_conversation));
        const new_facts_str = TaskOrchestrator.formatFacts(new_facts);

        planning_conversation.push(new AIMessage(
            TaskOrchestrator.formatFacts(new_facts)
        ));

        // Update the plan
        planning_conversation.push(
            new HumanMessage(this.getUpdatePlanPrompt(this.teamDescription))
        )

        const new_plan = await this.llm.withStructuredOutput(ORCHESTRATOR_UPDATE_PLAN_TYPE).invoke(this.defaultMessages.concat(planning_conversation))
        const new_plans = new_plan.plans.map((p) => [p.agent, p.task])
        const new_plan_str = new_plans.map((p) => `${p[0]}: ${p[1]}`).join("\n");

        return {
            task_ledger: new_facts,
            task_plan: new_plans,
            messages: [
                new AIMessage(this.getSynthesizePrompt(
                    state.task_description,
                    this.teamDescription,
                    new_facts_str,
                    new_plan_str
                ))
            ]
        }

    }

    async updateLedger(state: typeof TaskOrchestratorState.State) {
        this.logger.debug("update ledger")
        const ledger_messages: BaseMessage[] = [];
        state.messages.map((m) => ledger_messages.push(m));
        ledger_messages.push(new HumanMessage(this.getLedgerPrompt(state.task_description, this.teamDescription, Object.keys(this.members))))

        const ledger_data = await this.llm.withStructuredOutput(ORCHESTRATOR_LEDGER_TYPE).invoke(
            this.defaultMessages.concat(ledger_messages)
        )

        this.logger.debug("\n" + JSON.stringify(ledger_data, null, 4));

        return ledger_data;
    }

    async prepareFinalAnswer(state: typeof TaskOrchestratorState.State) {
        const final_messages: BaseMessage[] = [];
        state.messages.map((m) => final_messages.push(m));
        final_messages.push(new HumanMessage(this.getFinalAnswerPrompt(state.task_description)))

        const final_answer = await this.llm.invoke(
            this.defaultMessages.concat(final_messages)
        );

        this.logger.debug(`Final Report:\n${final_answer.content.toString()}`);

        return final_answer.content.toString();
    }

    async selectNextAgent(state: typeof TaskOrchestratorState.State) {
        this.logger.debug("select next agent");
        this.logger.debug("remain steps: " + state.task_plan.length);

        let {
            replan_counter,
            stall_counter
        } = state;
        // Orchestrate the next step
        const ledger_data = await this.updateLedger(state);

        // Task is complete
        if (ledger_data.is_request_satisfied.answer) {
            this.logger.debug("request satisfied");

            if (state.final_report == "") {
                // generate a final message to summarize the conversation
                state.final_report = await this.prepareFinalAnswer(state);
            }

            
            state.task.final_report = state.final_report;
            state.task.emit("response", {
                taskResponse: {
                    sender: 'Final Report',
                    message: state.final_report
                }
            })
            
            return END;
        }
        // console.log(state.messages.length)
        // Stalled or stuck in a loop
        if (ledger_data.is_in_loop.answer || !ledger_data.is_progress_being_made.answer) {
            stall_counter++;
            this.logger.debug("stall: " + stall_counter)
            if (stall_counter > TaskOrchestrator.MAX_STALL_BEFORE_REPLAN) {
                this.logger.debug("replan")
                replan_counter++;
                stall_counter = 0;
                if (replan_counter > TaskOrchestrator.MAX_REPLAN) {
                    replan_counter = 0;
                    stall_counter = 0;
                    this.logger.debug("Replan counter exceeded... Terminating.");
                    return END;
                } else {
                    //  Let's create a new plan
                    return "updateFactAndPlan";
                }
            }
        }

        // If we goit this far, we were not starting, done, or stuck


        let next_agent = state.task_plan.shift(); // get the first plan step
        if(!next_agent) return "updateFactAndPlan";

        // find the agent with plan
        for (let name in this.members) {
            if (name.toLowerCase() == next_agent[0].toLowerCase()) {
                let instruction = next_agent[1];
                return new Send(name, { ...state, instruction });
            }
        }

        return END;
    }

    createGraph(): StateGraph<any, any, UpdateType<any> | Partial<any>, string, any, any, StateDefinition> {
        const workflow = new StateGraph(this.AgentState);

        this.memberlist.forEach(m => {
            workflow.addNode(m.name, m.node.bind(m));
            workflow.addConditionalEdges(m.name as typeof START, this.selectNextAgent.bind(this));
        })

        workflow
            .addNode("initializeTask", this.initializeTask.bind(this))
            .addNode("updateFactAndPlan", this.updateFactAndPlan.bind(this))
            .addEdge(START, "initializeTask")
            .addConditionalEdges("initializeTask", this.selectNextAgent.bind(this))
            .addConditionalEdges("updateFactAndPlan", this.selectNextAgent.bind(this));

        this.graph = workflow.compile({
            checkpointer: new MemorySaver()
        });
        return workflow;
    }

    async processState(state: typeof BaseState.State, config: RunnableConfig) {
        const task = state.task;

        const threadConfig = {
            configurable: {
                thread_id: task.id, // 使用任務id
            }
        };

        if(this.graph.checkpointer) {
            let thread = await this.graph.checkpointer.get(threadConfig);
            if (this.runingTasks[task.id] && thread) {
                this.logger.debug("update thread for task: " + task.id);
                await this.graph.updateState(threadConfig, {
                    messages: [new HumanMessage(task.userInput)],
                    task_description: task.description,
                    task
                });
            } else {
                this.runingTasks[task.id] = true;
                this.logger.debug("create thread for task: " + task.id);
                const stream = await this.graph.stream(
                    {
                        messages: [new HumanMessage(task.userInput)],
                        task_description: task.description,
                        task
                    } as Partial<typeof TaskOrchestratorState.State>,
                    threadConfig
                );

                let lastStep;
                for await (const step of stream) {
                    lastStep = step;
                    const [stepName, stepState] = Object.entries(step)[0];

                    if(Object.keys(this.members).includes(stepName) && (stepState as typeof TaskOrchestratorState.State).messages) {
                        let msg = (stepState as typeof TaskOrchestratorState.State).messages.map((m) => m.content).join("\n");
                        task.emit("response", {
                            taskResponse: {
                                sender: stepName,
                                message: msg
                            }
                        })
                    }
                    
                    // console.log(stepName, stepState);
                    // // @ts-ignore
                    // console.log("rolled out: ", stepState?.root?.height);
                    // if(stepState?.messages) {
                        
                    // }
                    this.logger.debug("---");
                }
            }
        }
    }


    private static formatFacts(facts: z.infer<typeof ORCHESTRATOR_CLOSED_BOOK_TYPE>) {
        return Object.keys(facts).map((member) => {
            let name = member.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") // remove underscores
            return `${name}: \n` + facts[member as keyof typeof facts].map((f) => `    - ${f}`).join("\n");
        }).join("\n")
    }

    private getClosedBookPrompt(task: string): string {
        return ORCHESTRATOR_CLOSED_BOOK_PROMPT.replace("{task}", task);
    }

    private getPlanPrompt(team: string): string {
        return ORCHESTRATOR_PLAN_PROMPT_V2.replace("{team}", team);
    }

    private getSynthesizePrompt(task: string, team: string, facts: string, plan: string): string {
        return ORCHESTRATOR_SYNTHESIZE_PROMPT
            .replace("{task}", task)
            .replace("{team}", team)
            .replace("{facts}", facts)
            .replace("{plan}", plan);
    }

    private getLedgerPrompt(task: string, team: string, names: string[]): string {
        return ORCHESTRATOR_LEDGER_PROMPT
            .replace("{task}", task)
            .replace("{team}", team)
            .replace("{names}", names.join(", "));
    }

    private getUpdateFactsPrompt(task: string, facts: string): string {
        return ORCHESTRATOR_UPDATE_FACTS_PROMPT
            .replace("{task}", task)
            .replace("{facts}", facts);
    }

    private getUpdatePlanPrompt(team: string): string {
        return ORCHESTRATOR_UPDATE_PLAN_PROMPT.replace("{team}", team);
    }

    private getFinalAnswerPrompt(task: string): string {
        return ORCHESTRATOR_GET_FINAL_ANSWER
            .replace("{task}", task);
    }
}