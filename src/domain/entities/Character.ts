import { readFile } from 'fs/promises';
import { join } from 'path';

import { ComponentContainer } from '../../ComponentContainer';

export type IChatHistory = {
    role: "ASSISTANT" | "USER";
    content: string;
}

export interface ICharacter {
    /**
     * 名字
     */
    name: string

    /**
     * uid
     */
    id: string

    /**
     * 身份描述
     */
    description: string[];

    /**
     * 個性描述
     */
    personality: string[];

    /**
     * 歡迎訊息
     */
    greeting: string[];

    /**
     * 規則
     */
    rules: string[];

    /**
     * 預設聊天記錄
     */
    history: IChatHistory[];
}

export class Character implements ICharacter {
    name: string = "UnNamedCharacter";
    id: string = "CHARACTER-";
    description: string[] = [];
    personality: string[] = [];
    greeting: string[] = [];
    rules: string[] = [];
    history: IChatHistory[] = [];

    static instance: Character;

    constructor(character: ICharacter) {
        Object.assign(this, character);
    }

    static async getDefaultCharacter() {
        if(!Character.instance) {
            Character.instance = await Character.loadFromFile()
        }
        return Character.instance;
    }

    /**
     * 載入角色設定檔
     */
    static loadFromFile(name?: string) {
        return new Promise<ICharacter>(async (resolve, reject) => {
            const {
                CharacterDir,
                defaultCharacter
            } = ComponentContainer.getConfig();
            name = name ? name : defaultCharacter;
            ComponentContainer.getConfig().logger.info("Reading Character File: " + name);
            const data = await readFile(join(CharacterDir, name + ".json"), "utf-8").catch(reject);
            if (data) {
                try {
                    const character = JSON.parse(data);
                    resolve(character);
                } catch (err) {
                    reject(err);
                }
            }
        });
    }
}