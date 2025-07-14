import { z } from 'zod';

import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { Command, interrupt } from '@langchain/langgraph';

export const askHuman = tool(
    async ({ question }) => {
        try {
            const userInput = interrupt(question);
            
            // const activeAgent = "Researcher";
            // return new Command({
            //     goto: activeAgent,
            //     update: {
            //         messages: [
            //             new HumanMessage(userInput)
            //         ]
            //     }
            // });
            return userInput;
        } catch (error) {
            let msg = `Failed to process input: ${error instanceof Error ? error.message : error}`;
            return msg;
        }
    },
    {
        name: "ask_human",
        description: "Ask the user for missing information.",
        schema: z.object({
            question: z.string().describe("The question to ask the user."),
        }),
    }
);