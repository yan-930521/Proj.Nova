import ivm from 'isolated-vm';
import { z } from 'zod';

import {
    _INTERNAL_ANNOTATION_ROOT, Annotation, END, START, StateGraph
} from '@langchain/langgraph';

import { ComponentContainer } from '../../ComponentContainer';
import { BaseSuperVisor } from '../../libs/base/BaseSupervisor';
import { JSONOutputToolsParser, Nova } from '../Nova';
import { Session } from '../SessionContext';
import { CreateLongtermTask, LongTermTaskLLMOutputSchema } from '../tools/system';
import { Scheduler, ThresholdResponse } from './Scheduler';
import { LongtermTask } from './Task';

export const LongtermTaskManagerState = Annotation.Root({
    input: Annotation<string>,
    session: Annotation<Session>,
    task: Annotation<LongtermTask>,
    shouldRetry: Annotation<boolean>
});

export class LongtermTaskManager extends BaseSuperVisor {
    public AgentState = LongtermTaskManagerState;
    public tasks = new Map<string, LongtermTask>();
    public scheduler = new Scheduler();
    public isolate = new ivm.Isolate({ memoryLimit: 2048 }); // 限制記憶體2G

    // @ts-ignore
    public context: ivm.Context;

    constructor() {
        super({
            name: "LongtermTaskBuilder"
        });
    }

    protected async initLogic(): Promise<void> {
        this.context = await this.isolate.createContext();
        const jail = this.context.global;
        // 必須將 global 的 reference 指向自身，讓全局可用
        await jail.set('global', jail.derefInto());

        await jail.set('log', (...args: any[]) => {
            console.log('[VM]', ...args);
        });

    }

    public registerMonitor(task: LongtermTask) {
        if (task.monitor_config.resources.length === 0) return;

        task.monitor_config.resources.forEach((res) => {
            this.logger.debug(`Register Resource: ${res.name}`);
            // 設定條件函式
            this.scheduler.setThresholdCondition(res.name, () => {
                let response: ThresholdResponse | null = null;
                const rawValue = task.variables.get(res.name);
                const currentValue = Number(rawValue);

                if (isNaN(currentValue)) {
                    response = null;
                    // throw new Error(`Resource "${res.name}" has non-numeric value: ${rawValue}`);
                } else {
                    if (res.threshold !== undefined) {
                        if (res.on_below_threshold && currentValue < res.threshold) {
                            response = {
                                type: 'on_below_threshold',
                                action: res.on_below_threshold
                            };
                        }
                        if (res.on_above_threshold && currentValue > res.threshold) {
                            response = {
                                type: 'on_above_threshold',
                                action: res.on_above_threshold
                            };
                        }
                    }

                    if ((res.min !== undefined && currentValue < res.min) ||
                        (res.max !== undefined && currentValue > res.max)) {
                        if (res.on_violation) {
                            response = {
                                type: 'on_violation',
                                action: res.on_violation
                            };
                        }
                    }
                }

                return response;
            });
        });

        setInterval(() => {
            this.logger.debug("Checking Thresholds");
            this.scheduler.checkThresholds();
        }, 2000)
    }

    public registerSubtasks(task: LongtermTask) {
        if (task.subtasks.length === 0) return;

        task.subtasks.forEach((st) => {
            this.logger.debug(`Register Subtask: ${st.name}`);
            this.scheduler.register({
                name: st.name,
                type: st.schedule.type,
                trigger: st.schedule.trigger,
                execute: async () => {
                    if (st.type === "jscode" && st.js_code) {
                        const res = await this.safeEvalJS(st.js_code);
                        if (res.result && st.resource) {
                            task.variables.set(st.resource, String(res.result));
                        }
                        if (res.error) {
                            console.warn(res.error)
                        }
                    } else if (st.type === "callagent") {
                        // TODO: 整合呼叫sub agent 方法
                    }
                }
            });
        });
    }

    public async safeEvalJS(jsCode: string, timeout?: number) {
        try {
            const script = await this.isolate.compileScript(jsCode);
            const result = await script.run(this.context, { timeout: timeout });
            return { result };
        } catch (err) {
            return { error: String(err) };
        }
    }

    public async buildDraft(state: typeof LongtermTaskManagerState.State) {
        const { input, session } = state;
        const result = await this.llm.bindTools([CreateLongtermTask], { tool_choice: CreateLongtermTask.name })
            .pipe(JSONOutputToolsParser)
            .invoke(Nova.getMessages(session));

        let longtermTask = result[0].args as unknown as z.infer<typeof LongTermTaskLLMOutputSchema>;
        this.logger.debug(`[task]: ${longtermTask.name}`);

        const task = new LongtermTask({
            user: session.user,
            userInput: input,
            ...longtermTask
        });

        return { task }
    }

    private evalTask(state: typeof LongtermTaskManagerState.State) {
        const { task, session } = state;

        return {}
    }

    private reflectAndRetry(state: typeof LongtermTaskManagerState.State) {
        const { input, session } = state;

        return {}
    }

    private finalize(state: typeof LongtermTaskManagerState.State) {
        const { input, session } = state;
        return {}
    }

    private createWorkflow() {
        const workflow = new StateGraph(LongtermTaskManagerState);

        workflow
            .addNode("buildDraft", this.buildDraft.bind(this))   // 建立初步任務
            .addNode("evalTask", this.evalTask.bind(this))       // 評估子任務合理性與可執行性
            .addNode("reflect", this.reflectAndRetry.bind(this)) // 反思與重新建立
            .addNode("finalize", this.finalize.bind(this))       // 最終化任務，註冊 subtasks & monitor

            .addEdge(START, "buildDraft")
            .addEdge("buildDraft", "evalTask")
            .addEdge("evalTask", "reflect")
            .addConditionalEdges("reflect", (state) => {
                // 判斷是否需要重新生成或可以進入 finalize
                return state.shouldRetry ? "buildDraft" : "finalize";
            })
            .addEdge("finalize", END);

        return workflow;
    }
}