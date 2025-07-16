export class Logger {
    /**
     * logger的名字
     */
    public name: string;
    public paddedName: string = "";

    private subLoggers: {
        [name: string]: {
            name: string;
            paddedName: string;
        }
    } = {}

    readonly maxNameLength: number = 12;

    constructor(loggerName: string) {
        this.name = loggerName;
        this.paddedName = this.padName(loggerName);
    }

    /**
     * 紀錄日誌訊息
     * @param level 日誌等級 (info, warn, error, debug)
     * @param message 要記錄的訊息
     */
    log(level: 'info ' | 'warn ' | 'error' | 'debug', message: string) {
        const timestamp = new Date().toISOString(); // 紀錄時間戳
        console.log(`[${timestamp}] [${this.paddedName}] [${level.toUpperCase()}]: ${message}`);
    }

    /**
     * 快速記錄 info 訊息
     * @param message 訊息內容
     */
    info(message: string, loggerName: string = this.name) {
        let processedMessage = message.split(" ").map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
        this.log('info ', processedMessage);
    }

    /**
     * 快速記錄 warn 訊息
     * @param message 訊息內容
     */
    warn(message: string, loggerName: string = this.name) {
        this.log('warn ', message);
    }

    /**
     * 快速記錄 error 訊息
     * @param message 訊息內容
     */
    error(message: string, loggerName: string = this.name) {
        this.log('error', message);
        throw new Error(message);
    }

    /**
     * 快速記錄 debug 訊息
     * @param message 訊息內容
     */
    debug(message: string, loggerName: string = this.name) {
        this.log('debug', message);
    }


    createSubLogger(loggerName: string) {
        if (!this.isSubLogger(loggerName)) {
            this.setSubLogger(loggerName);
        } else {
            this.error("Create Failed: Sub Logger is exist.");
        }
    }

    isSubLogger(loggerName: string) {
        if (this.subLoggers[loggerName]) {
            return true;
        }
        return false;
    }

    setSubLogger(loggerName: string) {
        this.subLoggers[loggerName] = {
            name: loggerName,
            paddedName: this.padName(loggerName)
        }
    }
    
    getSubLogger(loggerName: string) {
        return this.subLoggers[loggerName];
    }

    /**
     * 格式化模組名稱，使其對齊
     */
    private padName(name: string): string {
        // 計算需要填充的空格數量
        const padding = this.maxNameLength - name.length;
        return name + ' '.repeat(Math.max(0, padding)); // 如果名稱太長則不填充
    }
}

