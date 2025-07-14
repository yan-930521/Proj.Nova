// use in LATS
import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { StateType } from '@langchain/langgraph';

import { ComponentContainer } from '../../../ComponentContainer';
import { BaseAgent } from '../../../libs/base/BaseAgent';
import { JSONOutputToolsParser } from '../../Nova';
import { LATS } from './LATS';
import { Node } from './Node';
import { Reflection, ReflectionData } from './Reflection';

export class Expansion<State extends StateType<any>> extends BaseAgent<State> {
    constructor() {
        super({
            name: "Expansion"
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = await ComponentContainer.getLLMManager().create("multi-output", {
            model: "gpt-4o-mini",
            maxTokens: 512,
            temperature: 0.2,
            n: 5
        })

        this._prompt = ChatPromptTemplate.fromMessages([
            ['system', "You are an AI assistant."],
            ["user", "{input}"],
            new MessagesPlaceholder({
                variableName: "messages",
                optional: true
            })
        ]);


        this._chain = this.prompt.pipe((inputs, config?: RunnableConfig) => {
            const messages = inputs.messages;
            return this.generateCandidates(messages, config)
        })

        this.node = async (state: State, config?: RunnableConfig) => {
            this.logger.debug("Expansion");
            // Starting from the "best" node in the tree, generate N candidates for the next step.
            const root = state.root;
            const bestCandidate: Node = this.select(root);

            // console.log(bestCandidate);
            // console.log(bestCandidate.reflection)

            const messages = bestCandidate.getTrajectory();

            // Generate N candidates from the single child candidate
            const newCandidates = await this.generateCandidates(messages, config);

            const parsed = await JSONOutputToolsParser.batch(newCandidates);
            const flattened = parsed.flatMap((toolCalls, i) =>
                toolCalls.map((toolCall: any) => [i, toolCall])
            );

            const toolResponses = await Promise.all(
                flattened.map(async ([i, toolCall]) => {
                    return {
                        i,
                        response: await LATS.toolNode.invoke({
                            messages: [
                                new AIMessage({
                                    content: "",
                                    tool_calls: [{
                                        name: toolCall.type,
                                        args: toolCall.args,
                                        id: toolCall.id,
                                    }],
                                })
                            ]
                        })
                    };
                })
            );

            const collectedResponses: { [key: number]: any[] } = {};

            toolResponses.forEach(({ i, response }) => {
                if (!collectedResponses[i]) {
                    collectedResponses[i] = [];
                }
                collectedResponses[i].push(response.messages[0]);
            });

            const outputMessages: any[] = [];
            newCandidates.forEach((candidate, i) => {
                outputMessages.push(collectedResponses[i] ? [candidate, ...collectedResponses[i]] : [candidate]);
            });

            // Reflect on each candidate
            
            this.logger.debug("Reflect");
            const reflections = await Promise.all(
                outputMessages.map((msges) => ({
                    input: state.input,
                    candidate: msges,
                })).map((inputs) => Reflection.reflect(inputs))
            );

            // Grow tree
            const childNodes = outputMessages.map((cand, i) => {
                return new Node(cand, ReflectionData.fromData(reflections[i]), bestCandidate);
            });

            bestCandidate.children.push(...childNodes);

            return {
                root: root
            };
        }
    }

    /**
     * Starting from the root node a child node is selected at each tree level until a leaf node is reached.
     * @param root 
     */
    select(root: Node) {
        if (root.children.length == 0) {
            return root;
        }
        let node: Node = root
        while (node.children.length > 0) {
            // 選擇具有最大 UCB 值的子節點
            let maxChild = node.children.reduce((max, child) =>
                child.upperConfidenceBound() > max.upperConfidenceBound() ? child : max, node.children[0]);
            node = maxChild;
        }
        return node;
    }

    async generateCandidates(messages: BaseMessage[], config?: RunnableConfig) {
        this.logger.debug("Generating candidates...");
        const boundKwargs = this.chain.lc_kwargs;

        const result = await this.llm.generate(
            [messages],
            {
                callbacks: config?.callbacks,
                runName: "GenerateCandidates",
                ...boundKwargs
            }
        );

        return result.generations[0].map((g) => {
            // @ts-ignore
            return g.message as BaseMessage;
        });
    }
}