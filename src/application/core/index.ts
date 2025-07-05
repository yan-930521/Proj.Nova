import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { RunnableConfig } from '@langchain/core/runnables';
import {
    Annotation, END, MemorySaver, Send, START, StateDefinition, StateGraph, task, UpdateType
} from '@langchain/langgraph';

import { ComponentContainer } from '../../ComponentContainer';
import { Task, TaskType } from '../../domain/entities/Task';
import { LevelDBTaskRepository } from '../../frameworks/levelDB/LevelDBTaskRepository';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../../libs/base/BaseSupervisor';
import { MemoryManager } from './amem/MemoryManager';
import { Character } from './character/Character';
import { SemanticEngine } from './SemanticEngine';
import { TaskOrchestrator } from './TaskOrchestrator';

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

    task: Annotation<Task>({
        reducer: (prev, next) => (next ?? prev)
    })
});

export const JSONOutputToolsParser = new JsonOutputToolsParser<{
    type: string,
    args: Record<string, string>,
    id: string
}[]>({ returnId: true });


export class CoreAgent extends BaseSuperVisor {
    AgentState = BaseState;

    constructor(options: BaseSuperVisorCallOptions = {}) {
        super({
            name: options?.name ?? "CoreAgent"
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = ComponentContainer.getLLMManager().getLLM()

        await this.loadMembers([
            new SemanticEngine({
                llm: this.llm,
            }),
            new Character(),
            new MemoryManager(),
            new TaskOrchestrator()
        ]);

        this.createGraph();
    }

    node(state: {}) {
        throw new Error('Method not implemented.');
    }

    createGraph(): StateGraph<any, any, UpdateType<any> | Partial<any>, string, any, any, StateDefinition> {
        const workflow = new StateGraph(this.AgentState);

        const _SemanticEngine_ = this.members["SemanticEngine"] as SemanticEngine;
        const _Character_ = this.members["Character"] as Character;
        const _TaskOrchestrator_ = this.members["TaskOrchestrator"] as TaskOrchestrator;
        const _MemoryManager_ = this.members["MemoryManager"] as MemoryManager;


        workflow.addNode(_SemanticEngine_.name, _SemanticEngine_.node.bind(_SemanticEngine_))
            .addNode(_MemoryManager_.name, _Character_.processState.bind(_MemoryManager_))
            .addNode(_Character_.name, _Character_.processState.bind(_Character_))
            .addNode(_TaskOrchestrator_.name, _TaskOrchestrator_.processState.bind(_TaskOrchestrator_))
            .addEdge(START, _SemanticEngine_.name)
            .addEdge(_TaskOrchestrator_.name, _Character_.name)

        workflow.addConditionalEdges(_SemanticEngine_.name as typeof START, async (state: typeof BaseState.State, config: RunnableConfig) => {
            const analyzeData = await _SemanticEngine_.analysisInput(state);

            let intent = analyzeData.intents[0] as TaskType;

            if (!intent) return END;

            let list = await LevelDBTaskRepository.getInstance().findByMetadata({
                type: intent,
                author: state.task.author,
            });

            list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(a.timestamp).getTime());

            let task = list[0];

            if (!task) {
                task = state.task;
                task.type = intent;
                task.description = analyzeData.task;
                task.updateTask();
                await LevelDBTaskRepository.getInstance().create(task);
            } else {
                let userInput = state.task.userInput;
                let description = state.task.description;
                let timestamp = state.task.timestamp;
                state.task.updateTask({
                    ...task,
                    userInput, // 防止被覆蓋
                    description,
                    timestamp
                }); // for event
                task = state.task;
                this.logger.debug("found task: " + JSON.stringify(task, null, 4));
            }

            const stream = await _MemoryManager_.graph.stream({
                messages: [new HumanMessage(task.userInput)],
                id: task.author.id
            });

            for await (let step of stream) {
                _MemoryManager_.logger.debug("---");
            }

            if (task.type == TaskType.CasualChat) {
                const serialized = state.messages.map((m => m.content));

                const memoryContent = await _MemoryManager_.searchMemory(task.author.id, serialized.join("\n"), 2, 2);

                return new Send(_Character_.name, {
                    ...state,
                    memories: memoryContent,
                    task
                });
            } else {
                return new Send(_TaskOrchestrator_.name, {
                    ...state,
                    task
                });
            }
        });

        this.graph = workflow.compile({
            checkpointer: new MemorySaver()
        });

        return workflow;
    }

    async processInput(task: Task) {
        const threadConfig = {
            configurable: {
                thread_id: task.author.id, // 使用用戶ID作為線程ID，但確認任務歸屬之後就使用任務id
            }
        };

        // if (this.graph.checkpointer) {
        // let thread = await this.graph.checkpointer.get(threadConfig);
        // if (thread) {
        //     this.logger.debug("update thread for user: " + user.id);
        //     await this.graph.updateState(threadConfig, {
        //         messages: [new HumanMessage(input)]
        //     });
        // } else {
        // this.logger.debug("create thread for user: " + user.id);

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
                // const [stepName, stepState] = Object.entries(step)[0];
                // console.log(stepName, stepState);
                // // @ts-ignore
                // console.log("rolled out: ", stepState?.root?.height);
                this.logger.debug("---", step);
            }
        } catch (err) {
            console.error(err);
            const _TaskOrchestrator_ = this.members["TaskOrchestrator"] as TaskOrchestrator;
            _TaskOrchestrator_.runingTasks[task.id] = false;
        }

        // }
        // }
    }
}