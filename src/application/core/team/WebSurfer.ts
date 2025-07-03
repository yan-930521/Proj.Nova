import { z } from 'zod';

import { TavilySearchResults } from '@langchain/community/tools/tavily_search';
import { WolframAlphaTool } from '@langchain/community/tools/wolframalpha';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicTool, tool } from '@langchain/core/tools';
import { StateType } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

import { ComponentContainer } from '../../../ComponentContainer';
import { BaseAgent, BaseAgentCallOptions } from '../../../libs/base/BaseAgent';
import { WEBSURFER } from '../prompts/team';

export class WebSurfer<State extends StateType<any>> extends BaseAgent<State> {
    node(state: State) {
        throw new Error('Method not implemented.');
    }

    static tools: {
        tavilyTool: TavilySearchResults;
        // wikiTool: WikipediaQueryRun;
        // braveTool: BraveSearch;
        // browserTool: WebBrowser;
    };


    constructor(options: BaseAgentCallOptions) {
        super({
            name: "WebSurfer",
            ...options
        });

        this._description = WEBSURFER;
    }

    protected async initLogic(): Promise<void> {
        this._llm = await ComponentContainer.getLLMManager().getLLM();

        WebSurfer.tools = {
            tavilyTool: new TavilySearchResults({
                maxResults: 4
            }),
            // llmTool: tool(async (question) => {
            //     try {
            //         let answer = await this.llm.invoke(question)
            //         return answer;
            //     } catch (error) {
            //         let msg = `Failed to ask question: ${error instanceof Error ? error.message : error}`;
            //         return msg;
            //     }
            // },
            //     {
            //         name: "LLM",
            //         description: "A llm to answer your question.",
            //         schema: z.string().describe("A question to ask llm.")
            //     })
        }

        this._chain = createReactAgent({
            llm: this.llm,
            messageModifier: new SystemMessage(WEBSURFER),
            tools: Object.values(WebSurfer.tools)
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
            console.log(lastMessage.content)
            return {
                messages: [
                    new HumanMessage(state.instruction),
                    new AIMessage({ content: `${lastMessage.content}`, name: this.name }),
                ],
            };
        }
    }


}