import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

import { BaseComponent } from '../libs/base/BaseComponent';

/**
 * Config設定
 */
export class Config extends BaseComponent {

    /**
     * 伺服器的端口
     */
    public port: number = 3300;



    public AppDir: string = "";
    public CharacterDir: string = "";
    public defaultCharacter: string = "";

    /**
     * 資料庫相關設定
     */
    public database: {
        /**
         * 資料庫所在的資料夾
         */
        dir: string,
        /**
         * 資料庫的名稱
         */
        name: string
    } = {
            dir: "",
            name: "",
        }
    /**
    * 向量資料庫相關設定
    */
    public vectraDatabase: {
        /**
         * 資料庫所在的資料夾
         */
        dir: string,
        /**
         * 資料庫的名稱
         */
        name: string
    } = {
            dir: "",
            name: "",
        }

    /**
    * Cube資料庫相關設定
    */
    public cubeDatabase: {
        /**
         * 資料庫所在的資料夾
         */
        dir: string,
        /**
         * 資料庫的名稱
         */
        name: string
    } = {
            dir: "",
            name: "",
        }

    public TAVILY_API_KEY: string = "";
    public BRAVE_FREE_AI: string = "";
    public DISCORD_TOKEN: string = "";
    public WOLFRAMALPHA_ID: string = "";

    public API_KEYS: Record<string, {
        "url": string,
        "apiKey": string
    }> = {};

    public DEFAULT_API_KEY: string = "";

    public optimizationTime: number = 1000 * 60 * 60;

    public isMultipleChat: boolean = false;

    constructor() {
        super({
            name: "Config"
        });
    }

    protected async initLogic(): Promise<void> {
        const appDir: string = join(__dirname, "../../");
        this.AppDir = appDir;

        this.logger.info("Set Env Path.");

        config({
            path: join(appDir, "vars", ".env")
        });

        if (typeof process.env.TAVILY_API_KEY === "string") this.TAVILY_API_KEY = process.env.TAVILY_API_KEY;
        else this.handleError("TAVILY_API_KEY not found.");

        if (typeof process.env.DISCORD_TOKEN === "string") this.DISCORD_TOKEN = process.env.DISCORD_TOKEN;
        else this.handleError("DISCORD_TOKEN not found.");

        if (typeof process.env.BRAVE_FREE_AI === "string") this.BRAVE_FREE_AI = process.env.BRAVE_FREE_AI;
        else this.handleError("BRAVE_FREE_AI not found.");

        if (typeof process.env.WOLFRAMALPHA_ID === "string") this.WOLFRAMALPHA_ID = process.env.WOLFRAMALPHA_ID;
        else this.handleError("WOLFRAMALPHA_ID not found.");

        this.logger.info("Reading Setting File.");
        const setting = this.loadConfig(join(appDir, "config", "setting.json"));

        for (let api in setting.API_KEYS) {
            let key = process.env[setting.API_KEYS[api].apiKey];
            if (typeof key === "string") setting.API_KEYS[api].apiKey = key;
            else this.handleError(`${setting.API_KEYS[api].apiKey} not found.`);
        }


        // setting.DirPath.App = appDir;

        this.fromJson(setting);
    }

    loadConfig(filePath: string): Config {
        try {
            const fileContent = readFileSync(filePath, 'utf-8');
            return JSON.parse(fileContent) as Config;
        } catch (error) {
            throw this.handleError(`Failed to read or parse config file at ${filePath}\n${JSON.stringify(error)}`);
        }
    }

    fromJson(jsonSetting: Config) {
        Object.assign(this, jsonSetting);
    }
}