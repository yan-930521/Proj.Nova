import { ComponentContainer } from '../../ComponentContainer';
import { User } from '../../domain/entities/User';
import { TypedEvent } from '../../libs/events/Events';
import { getUid } from '../../libs/utils/string';
import { AssistantResponse } from '../assistant/Assistant';

export enum TaskType {
    CasualChat = "CasualChat",
    TaskOriented = "TaskOriented",
    // TaskPlanning = "TaskPlanning",
    // KnowledgeQuestion = "KnowledgeQuestion",
    // Reminder = "Reminder",
    // CalendarManagement = "CalendarManagement",
    // EmailHandling = "EmailHandling",
    // WeatherQuery = "WeatherQuery",
    // NewsFetch = "NewsFetch",
    // Translation = "Translation",
    // MathCalculation = "MathCalculation",
    // CodeGeneration = "CodeGeneration",
    // WebSearch = "WebSearch",
    // DeviceControl = "DeviceControl",
    // FileManagement = "FileManagement",
    // NoteTaking = "NoteTaking",
    // TravelBooking = "TravelBooking"
}

export const TaskDescription: Record<TaskType, string> = {
    [TaskType.CasualChat]: "Engage in open-ended conversations or interactions without a specific task.",
    [TaskType.TaskOriented]: "Handle specific goal-directed tasks such as planning, report generation, or calculations."
    // [TaskType.TaskPlanning]: "Help plan, schedule, or coordinate a task or goal. Please avoid using this if possible, as it is very resource-intensive.",
    // [TaskType.KnowledgeQuestion]: "Answer factual or conceptual questions, including multi-step reasoning and complex problem-solving.",
    // [TaskType.Reminder]: "Set, update, or cancel reminders for the user.",
    // [TaskType.CalendarManagement]: "Manage calendar events, including creation, updates, and deletions.",
    // [TaskType.EmailHandling]: "Read, compose, or organize emails on behalf of the user.",
    // [TaskType.WeatherQuery]: "Provide current weather information or forecasts.",
    // [TaskType.NewsFetch]: "Fetch and summarize the latest news based on user interests.",
    // [TaskType.Translation]: "Translate text between different languages.",
    // [TaskType.MathCalculation]: "Perform mathematical calculations or solve equations.",
    // [TaskType.CodeGeneration]: "Generate code snippets or assist with programming tasks.",
    // [TaskType.WebSearch]: "Search the web for information and summarize results.",
    // [TaskType.DeviceControl]: "Control smart devices (e.g., lights, thermostat) as requested.",
    // [TaskType.FileManagement]: "Manage files, including upload, download, and organization.",
    // [TaskType.NoteTaking]: "Take, organize, or retrieve notes for the user.",
    // [TaskType.TravelBooking]: "Help book travel arrangements such as flights, hotels, or transportation."
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
        return "TASK-" + baseId;
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