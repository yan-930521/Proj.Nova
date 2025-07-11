import { CoreAgent } from './application/core';
import { LATS } from './application/core/lats/LATS';
import { BaseComponent } from './libs/base/BaseComponent';
import { Config } from './services/Config';
import { LLMManager } from './services/LLMManager';
import { TaskManager } from './services/TaskManager';

export class ComponentContainer {
    /**
     * 非同步初始化
     */
    private static components: Record<string, BaseComponent> = {};

    /**
     * 確保每個組件的初始化只會執行一次
     */
    private static async initializeComponent(componentName: string, initializer: () => Promise<BaseComponent>): Promise<BaseComponent> {
        if (!this.components[componentName]) {
            this.components[componentName] = await initializer();
        }
        return this.components[componentName];
    }

    private static instance: ComponentContainer;

    static async initialize(components: BaseComponent[]) {
        if (!ComponentContainer.instance) {
            ComponentContainer.instance = new ComponentContainer();
        }

        for(let i in components) {
            await this.initializeComponent(components[i].name, async () => {
                await components[i].init();
                return components[i];
            });
        }

        return Promise.all(
            Object.values(this.components)
        );
    }
    
    // Config
    static getConfig(): Config {
        return this.components["Config"] as unknown as Config;
    }

    // LLMManager
    static getLLMManager(): LLMManager {
        return this.components["LLM"] as unknown as LLMManager;
    }

    // TaskManager
    static getTaskManager(): TaskManager {
        return this.components["TaskManager"] as unknown as TaskManager;
    }

    // LATS
    static getLATS(): LATS {
        return this.components["LATS"] as unknown as LATS;
    }
}