import { z } from 'zod';

import { User } from '../../domain/entities/User';
import { getUid } from '../../libs/utils/string';
import { MonitorConfigSchema, SubtaskSchema } from '../tools/system';

export enum TaskType {
    CasualChat = "CasualChat",
    Shortterm = "Shortterm",
    Longterm = "Longterm"
}

export const TaskDescription: Record<TaskType, string> = {
    [TaskType.CasualChat]: "Engage in open-ended conversations or interactions without a specific task.",
    [TaskType.Shortterm]: "Handle short-term, goal-directed tasks such as planning, reporting, or simple calculations.",
    [TaskType.Longterm]: "Manage ongoing, multi-step processes that require monitoring, scheduling, and adaptive decision-making over time."
};

export enum TaskStatus {
    PENDING,
    IN_PROGRESS,
    DONE,
    FAILED
}

export interface TaskStatusChange {
    from: TaskStatus;
    to: TaskStatus;
    at: string;
}

export const ValidTaskStatusTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.FAILED],
    [TaskStatus.IN_PROGRESS]: [TaskStatus.DONE, TaskStatus.FAILED],
    [TaskStatus.DONE]: [],
    [TaskStatus.FAILED]: []
};

export interface RecordItem {
    action: string; // agent做了甚麼動作
    timestamp: string; // 動作時間
}

export type TaskResponse = {
    sender: string;
    instruction: string;
    message: string;
}

export type MonitorConfig = z.infer<typeof MonitorConfigSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;

export class Task {
    public id: string = Task.createId();

    public user: User;
    public userInput: string = "unknown input";
    public type: TaskType = TaskType.CasualChat;
    public timestamp: string = Date.now().toString();
    public status: TaskStatus = TaskStatus.PENDING; // 預設狀態

    public description: string = "unknown description";
    public final_report: string = "";
    public statusHistory: TaskStatusChange[] = [];

    public isComplete: boolean = false;

    public updateHistory: RecordItem[] = []; // 更新歷史紀錄

    public forceExit = new AbortController();

    public parent?: Task;



    constructor(
        taskData: { user: User } & Partial<Task>
    ) {
        this.user = taskData.user;
        Object.assign(this, taskData);

        this.statusHistory.push({
            from: TaskStatus.PENDING,
            to: TaskStatus.PENDING,
            at: new Date().toISOString()
        });
    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    static createId(baseId: string = getUid()) {
        return "SHORT_TERM_TASK-" + baseId;
    }

    updateRecord(record: RecordItem) {
        this.updateHistory.push(record);
    }

    updateTask(taskData: Partial<Task> = {}) {
        const forceExit = this.forceExit;
        Object.assign(this, taskData);
        this.forceExit = forceExit;
    }

    updateStatus(newStatus: TaskStatus) {
        if (this.status === newStatus) return;

        const allowed = ValidTaskStatusTransitions[this.status];
        if (!allowed.includes(newStatus)) {
            throw new Error(`Invalid status transition: ${TaskStatus[this.status]} → ${TaskStatus[newStatus]}`);
        }

        const now = new Date().toISOString();

        this.statusHistory.push({
            from: this.status,
            to: newStatus,
            at: now
        });

        this.status = newStatus;
    }

    getStatusHistory(): TaskStatusChange[] {
        return this.statusHistory;
    }

    /**
     * 判斷是否超時
     * @param timeoutMs
     * @returns 
     */
    isTimedOut(timeoutMs: number): boolean {
        if (this.status !== TaskStatus.IN_PROGRESS) return false;

        const last = this.statusHistory[this.statusHistory.length - 1];
        if (!last) return false;

        const startedAt = new Date(last.at).getTime();
        const now = Date.now();
        return (now - startedAt) > timeoutMs;
    }
}

export class LongtermTask extends Task {
    public name: string = "unknown name";
    public monitor_config: z.infer<typeof MonitorConfigSchema> = { resources: [] };
    public subtasks: z.infer<typeof SubtaskSchema>[] = [];

    public variables = new Map<string, string>();

    constructor(taskData: { user: User } & Partial<LongtermTask>) {
        super({ ...taskData, type: TaskType.Longterm });
        Object.assign(this, taskData);
    }

    static override createId(baseId: string = getUid()) {
        return `LONG_TERM_TASK-${baseId}`;
    }

    getSubtaskByName(name: string): Subtask | undefined {
        return this.subtasks.find(t => t.name === name);
    }
}
