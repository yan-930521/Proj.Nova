import cron from 'node-cron';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'timers';

export type ScheduleType = "cron" | "interval" | "event-driven" | "threshold-triggered";

export interface ScheduleConfig {
    name: string;
    type: ScheduleType;
    trigger: string; // e.g., "10m"、"0 9 * * *"、"2025-08-01T12:00:00Z"
    execute: () => Promise<void> | void;
}

export type ScheduledTaskHandle = {
    type: ScheduleType;
    cancel: () => void;
    execute: () => Promise<void> | void;
};

export interface ThresholdResponse {
    type: 'on_below_threshold' | 'on_above_threshold' | 'on_violation',
    action: string
}

export class Scheduler {
    private tasks = new Map<string, ScheduledTaskHandle>();
    private thresholds = new Map<string, () => ThresholdResponse | null>();
    private eventListeners = new Map<string, (() => Promise<void> | void)[]>();

    register(config: ScheduleConfig, allowOverride = false) {
        if (this.tasks.has(config.name) && !allowOverride) {
            throw new Error(`Schedule already exists: ${config.name}`);
        }

        let handle: ScheduledTaskHandle;

        switch (config.type) {
            case "cron":
                handle = this.registerCron(config.trigger, config.execute);
                break;
            case "interval":
                handle = this.registerInterval(config.trigger, config.execute);
                break;
            case "threshold-triggered":
                handle = this.registerThreshold(config.name, config.execute);
                break;
            case "event-driven":
                handle = this.registerEventDriven(config.name, config.execute);
                break;
            default:
                throw new Error(`Unsupported schedule type: ${config.type}`);
        }

        this.tasks.set(config.name, handle);
    }

    unregister(id: string, name: string) {
        const handle = this.tasks.get(id);
        if (handle) {
            handle.cancel();
            this.tasks.delete(id);
        }
    }

    private registerCron(expression: string, task: () => Promise<void> | void): ScheduledTaskHandle {
        if (!cron.validate(expression)) throw new Error(`Invalid cron expression: ${expression}`);
        const job = cron.schedule(expression, () => task());
        return {
            type: "cron",
            cancel: () => job.stop(),
            execute: task
        };
    }

    private registerInterval(trigger: string, task: () => Promise<void> | void): ScheduledTaskHandle {
        const ms = this.parseDuration(trigger);
        const timer = setInterval(() => task(), ms);
        return {
            type: "interval",
            cancel: () => clearInterval(timer),
            execute: task
        };
    }

    public setThresholdCondition(name: string, task: () => ThresholdResponse | null) {
        this.thresholds.set(name, task);
    }

    /** should be called regularly (e.g., every minute) */
    checkThresholds() {
        for (const [resourceName, checkFn] of this.thresholds.entries()) {
            let res = checkFn();
            if (res !== null) {
                const task = this.tasks.get(res.action);
                task?.execute();
            }
        }
    }

    private registerThreshold(name: string, task: () => Promise<void> | void): ScheduledTaskHandle {
        return {
            type: "threshold-triggered",
            cancel: () => this.tasks.delete(name),
            execute: task
        };
    }

    private registerEventDriven(name: string, task: () => Promise<void> | void): ScheduledTaskHandle {
        // 把任務綁定到事件名稱（name）
        if (!this.eventListeners.has(name)) {
            this.eventListeners.set(name, []);
        }
        this.eventListeners.get(name)!.push(task);

        return {
            type: "event-driven",
            cancel: () => {
                const arr = this.eventListeners.get(name);
                if (arr) {
                    this.eventListeners.set(name, arr.filter(fn => fn !== task));
                }
            },
            execute: task
        };
    }

    private parseDuration(duration: string): number {
        const match = duration.match(/^(\d+)([smhd])$/);
        if (!match) throw new Error(`Invalid duration: ${duration}`);
        const value = parseInt(match[1]);
        const unit = match[2];
        switch (unit) {
            case "s": return value * 1000;
            case "m": return value * 60 * 1000;
            case "h": return value * 60 * 60 * 1000;
            case "d": return value * 24 * 60 * 60 * 1000;
            default: throw new Error(`Unknown unit: ${unit}`);
        }
    }
}
