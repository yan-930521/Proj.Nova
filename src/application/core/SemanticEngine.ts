import { z } from 'zod';

import {
    ChatPromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate
} from '@langchain/core/prompts';
import { Runnable, RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Annotation, CompiledStateGraph, StateDefinition } from '@langchain/langgraph';

import { ComponentContainer } from '../../ComponentContainer';
import { TaskDescription, TaskType } from '../../domain/entities/Task';
import { BaseAgent, BaseAgentCallOptions } from '../../libs/base/BaseAgent';
import { BaseComponent } from '../../libs/base/BaseComponent';
import { Logger } from '../../libs/loggers/Logger';
import { BaseState, JSONOutputToolsParser } from './';
import { MEMORY_EXTRACTOR } from './prompts/amem';
import { TASK_GEN } from './prompts/task';

const userIntentValues = Object.values(TaskType) as [string, ...string[]];

export const SemanticEngineState = Annotation.Root({
});

export const AnalyzerSchema = z.object({
    intents: z.array(z.enum(userIntentValues)).describe(
        `The user's intents. Possible values:\n` +
        userIntentValues.map((key) => `${key}: ${TaskDescription[key as TaskType]}`).join("\n")
    ),
    task: z.string()
        .describe(TASK_GEN),
    // type: z.string()
    //     .default("general")
    //     .describe("The overall type or nature of the conversation or request (e.g., 'general', 'support', 'feedback')."),
    // keywords: z.array(z.string())
    //     .default([])
    //     .describe("Key terms or phrases mentioned in the user's input."),
    // context: z.string()
    //     .default("General")
    //     .describe("The situational or conversational context, e.g., topic or background info."),
    // sentiment: z.enum(["neutral", "happy", "angry", "sad", "confused"])
    //     .default("neutral")
    //     .describe("Detected emotional sentiment from the user's input."),
    // category: z.string()
    //     .default("Uncategorized")
    //     .describe("General classification label for the input."),
    // tags: z.array(z.string())
    //     .default([])
    //     .describe("Additional labels for flexible filtering, search, or tagging."),
});

export const AnalyzeTool = new DynamicStructuredTool({
    name: "Analyzer",
    description: "Analyze and record the user's intent, context, and meta information.",
    schema: AnalyzerSchema,
    func: async (input) => {
        const {
            intents,
            // targets,
            task,
            // urgency,
            // emotion,
            // followUpRequired,
        } = input;

        // 結構化回傳，方便後續程式處理
        return {
            intents,
            // targets: targets ?? [],
            task,
            // urgency: urgency ?? "normal",
            // emotion: emotion ?? "neutral",
            // followUpRequired: followUpRequired ?? false
        };
    }
});

export class SemanticEngine extends BaseAgent {

    constructor(options: BaseAgentCallOptions) {
        super({
            name: options.name ?? "SemanticEngine",
        });
    }

    protected async initLogic(): Promise<void | this> {
        this._llm = ComponentContainer.getLLMManager().getLLM();
        this._chain = this.llm.bind({
            tools: [AnalyzeTool],
            tool_choice: AnalyzeTool.getName()
        }).pipe(JSONOutputToolsParser);

        this._prompt = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate((MEMORY_EXTRACTOR)),
            new MessagesPlaceholder("messages")
        ]);

        return this;
    }

    node(state: any): any {
        this.logger.debug("start")
    }

    async analysisInput(state: typeof BaseState.State): Promise<z.infer<typeof AnalyzerSchema>> {
        try {
            this.logger.debug("Analysis Input");
            let data = await this.chain.invoke(state.messages);

            let analyzeData = data[0].args as unknown as z.infer<typeof AnalyzerSchema>;
            this.logger.debug("Result: \n" + JSON.stringify(analyzeData, null, 4));

            return analyzeData;
        } catch (error) {
            let erm = `Error in Intent Detection: `;
            if (error instanceof Error) {
                this.logger.error(erm + error.message);
            } else {
                this.logger.error(erm + String(error));
            }
            throw error;
        }
    }
}