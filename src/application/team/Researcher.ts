import { z } from 'zod';

import { TavilySearchResults } from '@langchain/community/tools/tavily_search';
import { WolframAlphaTool } from '@langchain/community/tools/wolframalpha';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicTool, tool } from '@langchain/core/tools';
import { StateType } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

import { ComponentContainer } from '../../ComponentContainer';
import { BaseAgent, BaseAgentCallOptions } from '../../libs/base/BaseAgent';
import { JSONOutputToolsParser } from '../Nova';
import { RESEARCHER } from '../prompts/team';

export class Researcher<State extends StateType<any>> extends BaseAgent<State> {
    // static tools: {
    //     deepthinking: DynamicTool
    // };

    constructor() {
        super({
            name: "Researcher"
        });

        this._description = RESEARCHER
    }

    protected async initLogic(): Promise<void> {
        const llm = await ComponentContainer.getLLMManager().getLLM();

        // Researcher.tools = {
        //     deepthinking: tool(async (question) => {
        //         try {
        //             console.log("test")
        //             let answer = await ComponentContainer.getLATS().processInput(question)
        //             return answer;
        //         } catch (error) {
        //             let msg = `Failed to ask question: ${error instanceof Error ? error.message : error}`;
        //             return msg;
        //         }
        //     }, {
        //         name: "deepthinking",
        //         description: "Leverages deep thinking capabilities of an LLM to process complex questions and provide insightful, well-reasoned responses.",
        //         schema: z.string().describe("A question or prompt requiring deep analysis or reasoning to be processed by the LLM.")
        //     })
        // }

        this._prompt = ChatPromptTemplate.fromMessages([new SystemMessage(RESEARCHER)]);

        this.node = async (state: State, config?: RunnableConfig) => {
            this.logger.debug("start");
            const response = await ComponentContainer.getLATS().processState({
                messages: state.messages,
                input: state.instruction,
                root: null
            });

            return {
                messages: [
                    new HumanMessage(state.instruction),
                    new AIMessage({ content: `${response}`, name: this.name }),
                ],
            };
        }
    }
}