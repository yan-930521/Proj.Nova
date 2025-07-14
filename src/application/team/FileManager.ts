import { z } from 'zod';

import { TavilySearchResults } from '@langchain/community/tools/tavily_search';
import { WolframAlphaTool } from '@langchain/community/tools/wolframalpha';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicTool } from '@langchain/core/tools';
import { StateType } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

import { ComponentContainer } from '../../ComponentContainer';
import { BaseAgent, BaseAgentCallOptions } from '../../libs/base/BaseAgent';
import { FILESURFER } from '../prompts/team';
import { downloadFileFromUrlTool } from '../tools/downloadFile';
import { readDirTool, readFileTool, writeFileTool } from '../tools/file';

export class FileManager<State extends StateType<any>> extends BaseAgent<State> {
    constructor() {
        super({
            name: "FileSurfer"
        });

        this._description = FILESURFER
    }

    protected async initLogic(): Promise<void> {
        const llm =  ComponentContainer.getLLMManager().getLLM();

        this._chain = createReactAgent({
            llm,
            messageModifier: new SystemMessage(FILESURFER),
            tools: [readFileTool, writeFileTool, readDirTool, downloadFileFromUrlTool]
        })

        this.node = async (state: State, config?: RunnableConfig) => {
            this.logger.debug("start");
            const result = await this.chain.invoke({
                messages: [
                    ...state.messages,
                    new HumanMessage(state.instruction)
                ]
            }, config);
            const lastMessage = result.messages[result.messages.length - 1];
            return {
                messages: [
                    new HumanMessage(state.instruction),
                    new AIMessage({ content: `${lastMessage.content}`, name: this.name }),
                ],
            };
        }
    }
}