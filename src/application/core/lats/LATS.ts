import { TavilySearchResults } from '@langchain/community/tools/tavily_search';
import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import {
    Annotation, END, MemorySaver, messagesStateReducer, START, StateDefinition, StateGraph,
    UpdateType
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';

import { JSONOutputToolsParser } from '../';
import { ComponentContainer } from '../../../ComponentContainer';
import { Task, TaskType } from '../../../domain/entities/Task';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../../../libs/base/BaseSupervisor';
import { Expansion } from './Expansion';
import { Node } from './Node';
import { Reflection, ReflectionData } from './Reflection';

export const LATSState = Annotation.Root({
    input: Annotation<string>({
        reducer: (x, y) => (y ?? x),
        default: () => "",
    }),
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
    root: Annotation<Node | null>({
        reducer: (x, y) => (y ?? x),
        default: () => null,
    }),
});
export class LATS extends BaseSuperVisor {
    AgentState = LATSState;

    static tools: {
        tavilyTool: TavilySearchResults;
    };
    static toolNode: ToolNode;

    constructor(options?: BaseSuperVisorCallOptions) {
        super({
            name: "LATS",
            ...options
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = ComponentContainer.getLLMManager().getLLM();

        this.members = {
            expansion: new Expansion({}),
            reflection: new Reflection({}),
        }

        LATS.tools = {
            tavilyTool: new TavilySearchResults({
                maxResults: 4
            })
        }
        LATS.toolNode = new ToolNode([LATS.tools.tavilyTool])

        this._prompt = ChatPromptTemplate.fromMessages([
            ["system", "You are an AI assistant.",],
            ["user", "{input}"],
            new MessagesPlaceholder("messages"),
        ]);

        this._chain = this.prompt.pipe(this.llm.bindTools(
            Object.values(LATS.tools)
        )).withConfig({ runName: "GenerateInitialCandidate" })

        this.node = async (state: typeof this.AgentState.State) => {
            this.logger.debug("Generating initial response...");

            const res = await this.chain.invoke({
                input: state.input,
                messages: []
            });

            const parsed = await JSONOutputToolsParser.invoke(res);
            let toolResponses = [];
            let outputMessages = [res];
            for (let r in parsed) {
                let res = await LATS.toolNode.invoke({
                    messages: [
                        new AIMessage({
                            content: "",
                            tool_calls: [
                                {
                                    name: parsed[r]["type"],
                                    args: parsed[r]["args"],
                                    id: parsed[r]["id"]
                                }
                            ]
                        })
                    ]
                });
                toolResponses.push(res);
                outputMessages.push(res.messages[0]);
            }

            let reflection: ReflectionData = await Reflection.reflect({
                input: state.input,
                candidate: outputMessages
            });

            let root = new Node(outputMessages, ReflectionData.fromData(reflection));

            return {
                root
            }
        }

        await this.loadMembers();
        this.createGraph();
    }

    node(state: typeof this.AgentState.State): any {
        throw new Error('Method not implemented.');
    }

    // Determine whether to continue the tree search.
    shouldContinue(state: typeof this.AgentState.State) {
        const root = state.root;
        if(!root) return END;

        if (root.isSolved) {
            return END;
        }
        if (root.height > 3) {
            return END;
        }
        return this.members.expansion.name;
    }

    /**
     * 建立圖
     */
    createGraph(): StateGraph<any, any, UpdateType<any> | Partial<any>, string, any, any, StateDefinition> {
        const workflow = new StateGraph(this.AgentState);

        workflow.addNode(this.name, this.node)
            .addNode(this.members.expansion.name, this.members.expansion.node)
            .addEdge(START, this.name)
            .addConditionalEdges(this.name, this.shouldContinue.bind(this))
            .addConditionalEdges(this.members.expansion.name, this.shouldContinue.bind(this))

        this.graph = workflow.compile({
            checkpointer: new MemorySaver(),
        });
        return workflow;
    }

    async processTask(task: Task) {
        const threadConfig = {
            configurable: { thread_id: task.author.id },
            recursionLimit: 50
        };

        const stream = await this.graph.stream(
            {
                input: task.description
            },
            threadConfig
        );

        let lastStep;
        for await (const step of stream) {
            lastStep = step;
            // const [stepName, stepState] = Object.entries(step)[0];
            // console.log(stepName, stepState);
            // // @ts-ignore
            // console.log("rolled out: ", stepState?.root?.height);
            console.log("---");
        }

        let rootNode: Node = lastStep[this.members.expansion.name]?.root ?? lastStep[this.name]?.root;
        let solutionNode = rootNode.getBestSolution();

        let bestTrajectory = solutionNode.getTrajectory(false);

        for await (const m of bestTrajectory) {
            console.log(m.content);
            console.log("---");
        }

        return solutionNode.getMessages().map((m) => m.content).join("\n");

        // console.log(bestTrajectory[bestTrajectory.length - 1].content);

        // console.log(bestTrajectory.map((m) => m.content).join("\n------\n"))

    }

    async processState(state: typeof LATSState.State) {
        const threadConfig = {
            recursionLimit: 50
        };

        const stream = await this.graph.stream(
            {
                input: state.input,
                messages: state.messages
            },
            threadConfig
        );

        let lastStep;
        for await (const step of stream) {
            lastStep = step;
            // const [stepName, stepState] = Object.entries(step)[0];
            // console.log(stepName, stepState);
            // // @ts-ignore
            if(step.root) console.log("rolled out: ", step.root.height);
            console.log("---");
        }

        let rootNode: Node = lastStep.root;
        let solutionNode = rootNode.getBestSolution();

        let bestTrajectory = solutionNode.getTrajectory(false);

        for await (const m of bestTrajectory) {
            console.log(m.content);
            console.log("---");
        }

        return solutionNode.getMessages().map((m) => m.content).join("\n");

        // console.log(bestTrajectory[bestTrajectory.length - 1].content);

        // console.log(bestTrajectory.map((m) => m.content).join("\n------\n"))

    }
}