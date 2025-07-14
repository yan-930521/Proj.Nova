import { z } from 'zod';

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { StateType } from '@langchain/langgraph';

import { ComponentContainer } from '../../../ComponentContainer';
import { BaseAgent } from '../../../libs/base/BaseAgent';
import { JSONOutputToolsParser } from '../../Nova';
import { REFLECTION } from '../../prompts/lats';

export const ReflectionSchema = z.object({
    reflections: z.string().describe("The critique and reflections on the sufficiency, superfluency, and general quality of the response"),
    score: z.number().int().describe("Score from 0-10 on the quality of the candidate response.").min(0).max(10),
    found_solution: z.boolean().describe("Whether the response has fully solved the question or task.")
})

export const ReflectionTool = new DynamicStructuredTool(
    {
        name: "Reflection",
        description: "Reflection tool to evaluate response quality.",
        schema: ReflectionSchema,
        func: async (input) => {
            // 通常這裡不會被實際呼叫，因為工具只給 LLM 用來產生格式化輸出
            const { reflections, score, found_solution } = input;
            return `Reflection captured: ${reflections}, score=${score}, found_solution=${found_solution}`;
        },
    }
)

export class ReflectionData {
    constructor(
        public reflections: string,
        public score: number,
        public found_solution: boolean
    ) {

    }

    static fromData(data: ReflectionData) {
        return new ReflectionData(
            data.reflections,
            data.score,
            data.found_solution
        );
    }

    asMessage() {
        return new HumanMessage(`Reasoning: ${this.reflections}\nScore: ${this.score}`);
    }

    normalizedScore() {
        return this.score / 10.0;
    }
}

export const ReflectPrompt = ChatPromptTemplate.fromMessages([
    ['system', REFLECTION],
    ["user", "{input}"],
    new MessagesPlaceholder({
        variableName: "candidate",
        optional: true
    }),
]);

export class Reflection<State extends StateType<any>> extends BaseAgent<State> {
    constructor() {
        super({
            name: "Reflection"
        });
    }

    protected async initLogic(): Promise<void> {
        this._llm = ComponentContainer.getLLMManager().getLLM()

        this._prompt = ReflectPrompt;

        this._chain = this.prompt.pipe(this.llm.bindTools([
            ReflectionTool
        ], {
            tool_choice: ReflectionTool.name,
            runName: "Reflection"
        }))
    }

    static getChain() {
        let llm = ComponentContainer.getLLMManager().getLLM()
        return ReflectPrompt.pipe(llm.bindTools([
            ReflectionTool
        ], {
            tool_choice: ReflectionTool.name,
            runName: "Reflection"
        }));
    }

    static async reflect(
        inputs: Record<string, any>
    ): Promise<ReflectionData> {
        const result = await Reflection.getChain().invoke(inputs);
        const reflectionData = await JSONOutputToolsParser.invoke(result);

        const reflection = ReflectionData.fromData(reflectionData[0].args as unknown as ReflectionData)
        // 如果最後一個 message 不是 AI message，標記為沒解決
        const last = inputs["candidate"][inputs["candidate"].length - 1];
        if (!(last instanceof AIMessage)) {
            reflection.found_solution = false;
        }
        return reflection;
    }
}