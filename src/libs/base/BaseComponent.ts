import { ComponentStatus } from '../enums/component/ComponentStatus';
import { TypedEvent } from '../events/Events';
import { Logger } from '../loggers/Logger';

/**
 * 預設事件
 */
export type BaseEvents = {
    /**
     * 錯誤
     */
    "Error": [Error],

    /**
     * 狀態改變
     */
    "StatusChange": [ComponentStatus]
}

/**
 * 合併事件
 */
export type Flatten<T> = T extends Record<string, any> ? { [k in keyof T]: T[k] } : never;

export interface BaseComponentCallOptions {
    /**
     * 模組名稱
     */
    name?: string;
    /**
     * 可選自訂 Logger
     */
    logger?: Logger;
}

export abstract class BaseComponent<TEvents extends Record<string, any> = {}> extends TypedEvent<Flatten<BaseEvents & TEvents>> implements BaseComponentCallOptions {
    public name: string = "UnnamedComponent";
    public status: ComponentStatus = ComponentStatus.LOADING;
    public startTime: number = 0;
    public logger: Logger;

    constructor(options: BaseComponentCallOptions) {
        super();
        if (options.name) {
            this.name = options.name;
        } else {
            // 預設名稱時警告
            console.warn('[BaseComponent] 未指定 name，將使用 "UnnamedComponent"');
        }
        this.logger = options.logger ?? new Logger(this.name);

        this.on("StatusChange", (status: ComponentStatus) => {
            this.logger.info(`StatusChange: ${status}`);
        });
        this.setStatus(ComponentStatus.LOADING);
    }

    public async init() {
        try {
            if (this.startTime === 0) {
                this.startTime = Date.now();
            }
            this.setStatus(ComponentStatus.INITIALIZING);

            await this.initLogic();

            this.setStatus(ComponentStatus.RUNNING);
            this.logger.info(`Component "${this.name}" initialized successfully.`);
        } catch (error) {
            this.handleError(error);
            this.setStatus(ComponentStatus.UNAVAILABLE);
        }
    }

    /**
     * 子類必須實作初始化邏輯
     */
    protected abstract initLogic(): Promise<typeof this | void>;

    /**
     * 設定狀態
     * @param st 狀態
     */
    protected setStatus(st: ComponentStatus): void {
        if (this.status !== st) {
            const prevStatus = this.status;
            this.status = st;
            this.logger.debug(`Status changed from ${prevStatus} to ${st}`);
            this.emit("StatusChange", st);
        }
    }

    /**
     * 處理錯誤的邏輯
     */
    protected handleError(error: any): Error {
        let e: Error = error instanceof Error ? error : new Error(String(error));
        this.emit("Error", e);
        this.logger.warn(e.message);
        // 不自動 setStatus(ERROR)，由子類決定
        return e;
    }

    /**
     * 移除所有事件監聽器
     */
    public offAll(): void {
        if (typeof (this as any).removeAllListeners === "function") {
            (this as any).removeAllListeners();
        }
    }

    /**
     * 釋放事件與資源
     */
    public dispose() {
        this.offAll();
        this.logger.info(`Component "${this.name}" disposed.`);
    }
}