/**
 * from https://github.com/microsoft/autogen/blob/v0.4.4/python/packages/autogen-magentic-one/src/autogen_magentic_one/agents/orchestrator_prompts.py
 */

import { z } from 'zod';

export const TASK_GEN = `Please summarize the user's input and prior conversation to generate a clear, detailed, and specific task description.  
The description should:  
- Explicitly state the main objective  
- Include any relevant context or constraints mentioned (e.g., referencing existing files, directories, or tools)  
- Avoid vague or overly brief summaries  
- Be actionable and easy to understand by developers or agents executing the task  `

export const ORCHESTRATOR_SYSTEM_MESSAGE = ""


export const ORCHESTRATOR_CLOSED_BOOK_PROMPT = `Below I will present you a request. Before we begin addressing the request, please answer the following pre-survey to the best of your ability. Keep in mind that you are Ken Jennings-level with trivia, and Mensa-level with puzzles, so there should be a deep well to draw from.

Here is the request:

{task}

Here is the pre-survey:

    1. Please list any specific facts or figures that are GIVEN in the request itself. It is possible that there are none.
    2. Please list any facts that may need to be looked up, and WHERE SPECIFICALLY they might be found. In some cases, authoritative sources are mentioned in the request itself.
    3. Please list any facts that may need to be derived (e.g., via logical deduction, simulation, or computation)
    4. Please list any facts that are recalled from memory, hunches, well-reasoned guesses, etc.

When answering this survey, keep in mind that "facts" will typically be specific names, dates, statistics, etc.
`

export const ORCHESTRATOR_CLOSED_BOOK_TYPE = z.object({
    given_facts: z.array(z.string()).describe("Facts that are given or verified in the request"),
    facts_to_look_up: z.array(z.string()).describe("Facts that need to be looked up, including where they might be found"),
    facts_to_derive: z.array(z.string()).describe("Facts that need to be derived through logical deduction, simulation, or computation"),
    educated_guesses: z.array(z.string()).describe("Hunches, well-reasoned guesses, or recalled facts from memory")
});


export const ORCHESTRATOR_PLAN_PROMPT = `Fantastic. To address this request we have assembled the following team:

{team}

Based on the team composition, and known and unknown facts, please devise a short bullet-point plan for addressing the original request. Remember, there is no requirement to involve all team members -- a team member's particular expertise may not be needed for this task.`

export const ORCHESTRATOR_PLAN_PROMPT_V2 = `Fantastic. To address this request we have assembled the following team:

{team}

Based on the team composition, and the known and unknown facts, please devise a detailed and sequential task plan to address the original request.

The plan must be organized as a step list with clear and explicit order, from start to finish.

For each step, specify:
- The objective of the step
- The expected outputs

Not all team members need to be involved — include them only if their specific expertise is required.
Ensure the entire process is complete, and that no essential step is omitted.`;

export const ORCHESTRATOR_PLAN_PROMPT_V3 = `Fantastic. To address this request we have assembled the following team:

{team}

Based on the team composition, and the known and unknown facts, please devise a detailed and sequential task plan to address the original request.

The plan must be organized as a step list with clear and explicit order, from start to finish.

For each step, specify:
- The objective of the step
- The expected outputs

Guidelines:
- **Avoid assigning consecutive steps to the same team member.**
- **If the same agent must appear more than once, try to alternate them with other agents when possible.**
- Only include team members whose expertise is relevant to each specific step.
- Ensure the process is logically complete — do not omit any essential step.`;


export const ORCHESTRATOR_PLAN_TYPE = z.object({
    plans: z.array(
        z.object({
            agent: z.string().describe("A team member's name"),
            task: z.string().describe("A specific task or action that the team member will take to address the request")
        })
    ).describe("A short bullet-point plan for addressing the original request, based on the team composition and known and unknown facts.")
});

export const ORCHESTRATOR_SYNTHESIZE_PROMPT = `
We are working to address the following user request:

{task}


To answer this request we have assembled the following team:

{team}


Here is an initial fact sheet to consider:

{facts}


Here is the plan to follow as best as possible:

{plan}
`

export const ORCHESTRATOR_LEDGER_PROMPT = `
Recall we are working on the following request:

{task}

And we have assembled the following team:

{team}

To make progress on the request, please answer the following questions, including necessary reasoning:

    - Is the request fully satisfied? (True if complete, or False if the original request has yet to be SUCCESSFULLY and FULLY addressed)
    - Are we in a loop where we are repeating the same requests and / or getting the same responses as before? Loops can span multiple turns, and can include repeated actions like scrolling up or down more than a handful of times.
    - Are we making forward progress? (True if just starting, or recent messages are adding value. False if recent messages show evidence of being stuck in a loop or if there is evidence of significant barriers to success such as the inability to read from a required file)
    - Who should speak next? (select from: {names})
    - What instruction or question would you give this team member? (Phrase as if speaking directly to them, and include any specific information they may need)
`

export const ORCHESTRATOR_LEDGER_TYPE = z.object({
    is_request_satisfied: z.object({
        reason: z.string(),
        answer: z.boolean()
    }),
    is_in_loop: z.object({
        reason: z.string(),
        answer: z.boolean()
    }),
    is_progress_being_made: z.object({
        reason: z.string(),
        answer: z.boolean()
    }),
    // next_speaker: z.object({
    //     reason: z.string(),
    //     answer: z.string()
    // }).describe("Identify the team member who should speak next, based on the current conversation, prior task plan, and task progress."),
    // instruction_or_question: z.object({
    //     reason: z.string(),
    //     answer: z.string()
    // })
});


export const ORCHESTRATOR_UPDATE_FACTS_PROMPT = `As a reminder, we are working to solve the following task:

{task}

It's clear we aren't making as much progress as we would like, but we may have learned something new. Please rewrite the following fact sheet, updating it to include anything new we have learned that may be helpful. Example edits can include (but are not limited to) adding new guesses, moving educated guesses to verified facts if appropriate, etc. Updates may be made to any section of the fact sheet, and more than one section of the fact sheet can be edited. This is an especially good time to update educated guesses, so please at least add or update one educated guess or hunch, and explain your reasoning.

Here is the old fact sheet:

{facts}
`

export const ORCHESTRATOR_UPDATE_PLAN_PROMPT = `Please briefly explain what went wrong on this last run (the root cause of the failure), and then come up with a new plan that takes steps and/or includes hints to overcome prior challenges and especially avoids repeating the same mistakes. As before, the new plan should be concise, be expressed in bullet-point form, and consider the following team composition (do not involve any other outside people since we cannot contact anyone else):

{team}
`
export const ORCHESTRATOR_UPDATE_PLAN_TYPE = z.object({
    root_cause: z.string().describe("A brief explanation of what went wrong on the last run, including the root cause of the failure"),
    plans: z.array(
        z.object({
            agent: z.string().describe("A team member's name"),
            task: z.string().describe("A specific task or action that the team member will take to address the request")
        })
    ).describe("A short bullet-point plan for addressing the original request, based on the team composition and known and unknown facts.")
});


export const ORCHESTRATOR_GET_FINAL_ANSWER = `
We are working on the following task:
{task}

We have completed the task.

The above messages contain the conversation that took place to complete the task.

Based on the information gathered, provide the final answer to the original request.
The answer should be phrased as if you were speaking to the user.
`