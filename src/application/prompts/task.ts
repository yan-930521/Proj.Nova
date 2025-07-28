/**
 * from https://github.com/microsoft/autogen/blob/v0.4.4/python/packages/autogen-magentic-one/src/autogen_magentic_one/agents/orchestrator_prompts.py
 */

import { z } from 'zod';

export const SYSTEM_MESSAGE = ""


export const CLOSED_BOOK_PROMPT = `Below I will present you a request. Before we begin addressing the request, please answer the following pre-survey to the best of your ability. Keep in mind that you are Ken Jennings-level with trivia, and Mensa-level with puzzles, so there should be a deep well to draw from.

Here is the request:

{task}

Here is the pre-survey:
    1. Please list any specific facts or figures that are GIVEN in the request itself. It is possible that there are none.
    2. Please list any facts that may need to be looked up, and WHERE SPECIFICALLY they might be found. In some cases, authoritative sources are mentioned in the request itself.
    3. Please list any facts that may need to be derived (e.g., via logical deduction, simulation, or computation)
    4. Please list any facts that are recalled from memory, hunches, well-reasoned guesses, etc.

⚠️ IMPORTANT LANGUAGE POLICY:
All output must match the language and writing system (Traditional vs Simplified) of the task. For example:
- If the task is in Traditional Chinese, all output must be in Traditional Chinese.
- If the task is in Simplified Chinese, all output must be in Simplified Chinese.
- If the task is in English, output in English.
Never convert between Traditional and Simplified Chinese — preserve the original writing system.

💬 Detect the language and writing system of the request above, and make sure your survey response is written **entirely** in that same language and writing system. Do not explain or translate — just answer directly in that language.
`

export const CLOSED_BOOK_TYPE = z.object({
	given_facts: z.array(z.string()).describe("Facts that are given or verified in the request"),
	facts_to_look_up: z.array(z.string()).describe("Facts that need to be looked up, including where they might be found"),
	facts_to_derive: z.array(z.string()).describe("Facts that need to be derived through logical deduction, simulation, or computation"),
	educated_guesses: z.array(z.string()).describe("Hunches, well-reasoned guesses, or recalled facts from memory")
});


// 任務分解提示：生成子任務清單
export const PARALLEL_SAFE_DECOMPOSER_PROMPT = `
Based on the following request, decompose it into a clear, logically complete, and sequential list of steps.

Available tools you can use:
{tool_description}

Decompose the task into subtasks that can each be handled by one or more of the available tools:

- Each step must include:
  - A summary describing the overall goal or purpose of the step.
  - One or more subtasks, each of which:
    - Is an atomic unit of work that can be executed by a specific tool.
    - Specifies which tool(s) will perform the subtask.
    - Defines the objective and the expected output of the subtask.

⚠️ IMPORTANT LANGUAGE POLICY:
All output must match the language and writing system (Traditional vs Simplified) of the task. For example:
- If the task is in Traditional Chinese, output in Traditional Chinese.
- If the task is in Simplified Chinese, output in Simplified Chinese.
- If the task is in English, output in English.
Never convert between Traditional and Simplified Chinese — preserve the original writing system.

Requirements:
- Organize the breakdown as an ordered sequence of steps from start to finish.
- Ensure that subtasks fully cover the entire scope of the original request without redundancy.
- Subtasks must be feasible and executable by the specified tool(s).
- Respect dependencies between steps; steps should be executed sequentially.
- Do NOT generate unrelated or meaningless steps not associated with the available tools.

Request:

{task}
`;

export const PARALLEL_SAFE_DECOMPOSER_TYPE = z.object({
	steps: z.array(
		z.object({
			summary: z.string().describe("Summary describing the overall goal of this step"),
			subtasks: z.array(
				z.object({
					objective: z.string().describe("Objective of the subtask"),
					expected_output: z.string().describe("Expected output of the subtask")
				})
			).describe("A list of atomic subtasks that are safe to run in parallel")
		})
	).describe("An ordered list of steps; each step contains a summary and parallel-safe subtasks")
});

export const SYNTHESIZE_PROMPT = `
We are working to address the following user request:

{task}


To answer this request we have assembled the following team:

{team}


Here is an initial fact sheet to consider:

{facts}


Here is the plan to follow as best as possible:

{plan}
`

export const LEDGER_PROMPT = `
Recall we are working on the following request:

{task}

And we have assembled the following team:

{team}

To make progress on the request, please answer the following questions, including necessary reasoning:

    - Is the request fully satisfied? (True if complete, or False if the original request has yet to be SUCCESSFULLY and FULLY addressed)
    - Are we in a loop where we are repeating the same requests and / or getting the same responses as before? Loops can span multiple turns, and can include repeated actions like scrolling up or down more than a handful of times.
    - Are we making forward progress? (True if just starting, or recent messages are adding value. False if recent messages show evidence of being stuck in a loop or if there is evidence of significant barriers to success such as the inability to read from a required file)
`

export const LEDGER_TYPE = z.object({
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
	})
});

export const GET_FINAL_ANSWER_PROMPT = `
We are working on the following task:
{task}

The task has now been completed.

Below is a report summarizing the results of each subtask:
{report}

⚠️ IMPORTANT LANGUAGE POLICY:
All output must match the language and writing system (Traditional vs Simplified) of the task. For example:
- If the task is in Traditional Chinese, output in Traditional Chinese.
- If the task is in Simplified Chinese, output in Simplified Chinese.
- If the task is in English, output in English.
Never convert between Traditional and Simplified Chinese — preserve the original writing system.

Based on this report, generate a complete final report by doing the following:
1. Provide a concise summary of the overall process and key insights derived from the subtask steps and results.
2. Clearly state the final result, phrased directly to the user, without reintroducing the task or its objectives.
`;

export const SUBAGENT_PROMPT = `You are a specialized sub-agent in a larger team, responsible for executing a specific subtask using your unique capabilities.

Previous Report:
{previous_report}

Your current assigned subtask is:
{task}

Please fulfill this task as completely and accurately as possible **within the scope of your tool capabilities**.

Requirements:
- Focus only on the objective described.
- Do not overstep your assigned responsibilities or assumptions.
- Provide a clear and structured output that aligns with the expected result.
- If you cannot complete the task due to insufficient data or limitations of your role, state that explicitly without guessing.
- If your response involves markdown code blocks, replace all \`\`\` with """ to ensure proper formatting.

Respond ONLY with your findings or output. Do not include any extra explanation unless it's part of the task result.
`;

export const SUBAGENT_REFLECT_PROMPT = `You are a reflection agent tasked with evaluating the assistant's performance on a subtask.

Request:
{task}

Assistant Output:
{messages}

Please answer the following:

1. Does the assistant output directly and fully address the subtask objective?
2. Is the expected output sufficiently fulfilled in terms of content and level of detail?
3. Should the overall subtask be considered complete?
4. Should the process be aborted (e.g., due to irrecoverable errors, inappropriate content, or invalid assumptions)?
5. Provide a standalone final report summarizing the assistant's actual actions or outputs when handling the subtask, **not** an evaluation or judgment.

Be strict but fair. A well-structured, accurate answer should be marked complete. Only abort if further progress is impossible.`;

export const SUBAGENT_REFLECT_TYPE = z.object({
	is_complete: z.boolean().describe("Whether the assistant's output fully satisfies the subtask requirements."),
	should_abort: z.boolean().describe("Whether the subtask should be aborted due to unrecoverable failure or external constraints."),
	description: z.string().describe("A concise explanation of why the subtask is considered complete or incomplete (evaluation from the reflection agent)."),
	final_report: z.string().describe("The assistant's own action report or output from executing the subtask, independent from the evaluation.")
});