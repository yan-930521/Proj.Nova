import { ChatOpenAI, ChatOpenAICallOptions, OpenAIEmbeddings } from '@langchain/openai';

import { ComponentContainer } from '../ComponentContainer';
import { BaseManager } from '../libs/base/BaseManager';

export interface LLMOption {
    model?: string;
    temperature?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    maxTokens?: number;
    stop?: string[];
    n?: number
}

export class LLMManager extends BaseManager<ChatOpenAI<ChatOpenAICallOptions>> {

    public readonly defaultLLM: string = "Reason";

    private _defaultEmbedingModel?: OpenAIEmbeddings;

    constructor() {
        super({
            name: "LLM"
        });
    }


    getEmbedingModel(): OpenAIEmbeddings {
        if (this._defaultEmbedingModel) {
            return this._defaultEmbedingModel;
        }

        try {
            const {
                API_KEYS,
                DEFAULT_API_KEY
            } = ComponentContainer.getConfig();

            this._defaultEmbedingModel = new OpenAIEmbeddings({
                model: "text-embedding-3-large",
                apiKey: API_KEYS[DEFAULT_API_KEY].apiKey,
                configuration: {
                    apiKey: API_KEYS[DEFAULT_API_KEY].apiKey,
                    baseURL: API_KEYS[DEFAULT_API_KEY].url
                },
                // verbose: true
            });

            return this._defaultEmbedingModel;
        } catch (err) {
            throw err;
        }
    }

    protected async initLogic(): Promise<void> {
        this.logger.info("Creating Default LLM: " + this.defaultLLM);
        // this.createLLM(this.defaultLLM, {
        //     model: "gpt-3.5-turbo",
        //     maxTokens: 512,
        //     temperature: 0.7,
        //     topP: 0.2,
        //     presencePenalty: 0.2,
        //     frequencyPenalty: 0.2,
        //     stop: []
        // });

        // this.create(this.defaultLLM, {
        //     model: "gpt-4o-mini", // "gpt-3.5-turbo",//
        //     maxTokens: 512,
        //     temperature: 0,
        //     stop: []
        // });

        this.create(this.defaultLLM, {
            model: "gpt-4o-mini", // "gpt-3.5-turbo",//
            maxTokens: 1024,
            temperature: 0.5,
            stop: []
        });
    }

    getLLM(name: string = this.defaultLLM) {
        const llm = this.getDataById(name);
        if (llm instanceof ChatOpenAI) {
            return llm;
        }
        this.handleError(`Get LLM[${name}] failed, using default LLM.`);
        return this.getDataById(this.defaultLLM) as ChatOpenAI;
    }

    /**
     * 載入大語言模型
     * @param name 
     * @param option 
     */
    async create(name: string, option: LLMOption) {
        const {
            API_KEYS,
            DEFAULT_API_KEY
        } = await ComponentContainer.getConfig();

        const llm = new ChatOpenAI({
            ...option,
            apiKey: API_KEYS[DEFAULT_API_KEY].apiKey,
            configuration: {
                apiKey: API_KEYS[DEFAULT_API_KEY].apiKey,
                baseURL: API_KEYS[DEFAULT_API_KEY].url
            },
            // verbose: true
        });

        this.setDataById(name, llm);
        return llm;
    }
}