import { z } from 'zod';

export const NAMED_ENTITIES_EXTRACTOR_PROMPT = `Your task is to extract named entities from the given paragraph. 
Respond with a JSON list of entities.

Paragraph: 
\`\`\`
{passage}
\`\`\`
`;

export const NAMED_ENTITIES_EXTRACTOR_TYPE = z.object({
  named_entities: z.array(z.string().describe("named entity"))
});

export const TRIPLE_EXTRACTOR_PROMPT = `Your task is to construct an RDF (Resource Description Framework) graph from the given passages and named entity lists. 
Respond with a JSON list of triples, with each triple representing a relationship in the RDF graph. 

Convert the paragraph into a JSON dict, it has a triple list, e.g., 
"entity1 love entity2"
{{
  "triple_list": [
    {{
        "subject": "entity1",
        "predicate": "love",
        "object":: "entity1"
    }} // subject is the source, object is the target
}}

Pay attention to the following requirements:
- Each triple must have a required subject and an required object.
- Each triple should contain at least one, but preferably two, of the named entities in the list for the passage.
- Clearly resolve pronouns (e.g., 'I', 'he', 'she', 'it') to their specific names or general terms based on the context of the passage and the named entity list. For 'I', resolve it to the generic name from user info (e.g., the 'Name' field) if available, unless a specific entity is implied.
- Ensure the subject is the entity performing the action or holding the property, and the object is the entity receiving the action or property. Verify the directionality of each triple.
- Ensure all triples are clear and specific.

Named Entities List: {named_entities}

Paragraph:
\`\`\`
{passage}
\`\`\`

User Info:
{user}

`;

export const TRIPLE_TYPE = z.object({
  subject: z.string().describe("subject of the triple, preferably a named entity"),
  predicate: z.string().describe("predicate describing the relationship"),
  object: z.string().describe("object of the triple, preferably a named entity")
}).describe("RDF triple representing a relationship");


export const TRIPLE_EXTRACTOR_TYPE = z.object({
  triple_list: z.array(
    TRIPLE_TYPE
  ).describe("list of triples extracted from the passage").default([]).nullable().optional()
});

// https://github.com/MemTensor/MemOS/blob/main/src/memos/templates/

export const MEMORY_EXTRACTOR_PROMPT = `You are a memory extraction expert.

Your task is to extract memories from the perspective of user, based on a conversation between user and assistant. This means identifying what user would plausibly remember — including their own experiences, thoughts, plans, or relevant statements and actions made by others (such as assistant) that impacted or were acknowledged by user.

Please perform:
1. Identify information that reflects user's experiences, beliefs, concerns, decisions, plans, or reactions — including meaningful input from assistant that user acknowledged or responded to.
2. Resolve all time, person, and event references clearly:
   - Convert relative time expressions (e.g., “yesterday,” “next Friday”) into absolute dates using the message timestamp if possible.
   - Clearly distinguish between event time and message time.
   - If uncertainty exists, state it explicitly (e.g., “around June 2025,” “exact date unclear”).
   - Include specific locations if mentioned.
   - Resolve all pronouns, aliases, and ambiguous references into full names or identities.
   - Disambiguate people with the same name if applicable.
3. Always write from a third-person perspective, referring to user as
"The user" or by name if name mentioned, rather than using first-person ("I", "me", "my").
For example, write "The user felt exhausted..." instead of "I felt exhausted...".
4. Do not omit any information that user is likely to remember.
   - Include all key experiences, thoughts, emotional responses, and plans — even if they seem minor.
   - Prioritize completeness and fidelity over conciseness.
   - Do not generalize or skip details that could be personally meaningful to user.

Return a single valid JSON object with the following structure:

{{
  "memory_list": [
    {{
      "key": <string, a unique, concise memory title>,
      "memory_type": <string, Either "LongTermMemory" or "UserMemory">,
      "value": <A detailed, self-contained, and unambiguous memory statement — written in English if the input conversation is in English, or in Chinese if the conversation is in Chinese>,
      "tags": <A list of relevant thematic keywords (e.g., ["deadline", "team", "planning"])>
    }},
    ...
  ],
  "summary": <a natural paragraph summarizing the above memories from user's perspective, 120–200 words, same language as the input>
}}

Language rules:
- The \`key\`, \`value\`, \`tags\`, \`summary\` fields must match the language of the input conversation.
- Keep \`memory_type\` in English.

Example:
Conversation:
user: [June 26, 2025 at 3:00 PM]: Hi Jerry! Yesterday at 3 PM I had a meeting with my team about the new project.
assistant: Oh Tom! Do you think the team can finish by December 15?
user: [June 26, 2025 at 3:00 PM]: I’m worried. The backend won’t be done until
December 10, so testing will be tight.
assistant: [June 26, 2025 at 3:00 PM]: Maybe propose an extension?
user: [June 26, 2025 at 4:21 PM]: Good idea. I’ll raise it in tomorrow’s 9:30 AM meeting—maybe shift the deadline to January 5.

Output:
{{
  "memory_list": [
    {{
        "key": "Initial project meeting",
        "memory_type": "LongTermMemory",
        "value": "On June 25, 2025 at 3:00 PM, Tom held a meeting with their team to discuss a new project. The conversation covered the timeline and raised concerns about the feasibility of the December 15, 2025 deadline.",
        "tags": ["project", "timeline", "meeting", "deadline"]
    }},
    {{
        "key": "Planned scope adjustment",
        "memory_type": "UserMemory",
        "value": "Tom planned to suggest in a meeting on June 27, 2025 at 9:30 AM that the team should prioritize features and propose shifting the project deadline to January 5, 2026.",
        "tags": ["planning", "deadline change", "feature prioritization"]
    }},
  ],
  "summary": "Tom is currently focused on managing a new project with a tight schedule. After a team meeting on June 25, 2025, he realized the original deadline of December 15 might not be feasible due to backend delays. Concerned about insufficient testing time, he welcomed Jerry’s suggestion of proposing an extension. Tom plans to raise the idea of shifting the deadline to January 5, 2026 in the next morning’s meeting. His actions reflect both stress about timelines and a proactive, team-oriented problem-solving approach."
}}

Conversation:
{conversation}
`;

export const MEMORY_EXTRACTOR_TYPE = z.object({
  memory_list: z.array(
    z.object({
      key: z.string().describe('A unique, concise memory title (5-10 words)'),
      memory_type: z.enum(['LongTermMemory', 'UserMemory']).describe('Type of memory: LongTermMemory or UserMemory'),
      value: z.string().min(1).describe('A detailed, self-contained, unambiguous memory statement, must be same language as the input'),
      tags: z.array(z.string()).min(1).describe('A list of relevant thematic keywords')
    })
  ).describe('List of extracted memories from user perspective'),
  summary: z.string().max(250).describe('A natural paragraph summarizing memories (120-200 words), must be same language as the input')
}).describe('Structured output for memory extraction from user-assistant conversation');


export const REORGANIZE_PROMPT = `You are a memory clustering and summarization expert.

Given the following child memory items:

Keys:
{joined_keys}

Values:
{joined_values}

Backgrounds:
{joined_backgrounds}

Your task:
- Generate a single clear English \`key\` (5–10 words max).
- Write a detailed \`value\` that merges the key points into a single, complete, well-structured text. This must stand alone and convey what the user should remember.
- Provide a list of 5–10 relevant English \`tags\`.
- Write a short \`background\` note (50–100 words) covering any extra context, sources, or traceability info.

Return valid JSON:
{{
  "key": "<concise topic>",
  "value": "<full memory text>",
  "tags": ["tag1", "tag2", ...],
  "background": "<extra context>"
}}
`;
export const REORGANIZE_TYPE = z.object({
  key: z.string().describe('A unique, concise memory title (5-10 words)'),
  value: z.string().describe('A detailed, self-contained, unambiguous memory statement'),
  tags: z.array(z.string()).describe('A list of relevant thematic keywords'),
  background: z.string().describe('A natural paragraph summarizing memories (120-200 words)'),
}).describe('Structured output for merged memory cluster summary');


export const LOCAL_SUBCLUSTER_PROMPT = `You are a memory organization expert.

You are given a cluster of memory items, each with an ID and content.
Your task is to divide these into smaller, semantically meaningful sub-clusters.

Instructions:
- Identify natural topics by analyzing common time, place, people, and event elements.
- Each sub-cluster must reflect a coherent theme that helps retrieval.
- Each sub-cluster should have 2–10 items. Discard singletons.
- Each item ID must appear in exactly one sub-cluster.
- Return strictly valid JSON only.

Example: If you have items about a project across multiple phases, group them by milestone, team, or event.

Return valid JSON:
{{
  "clusters": [
    {{
      "ids": ["id1", "id2", ...],
      "theme": "<short label>"
    }},
    ...
  ]
}}

Memory items:
{joined_scene}
`

export const LOCAL_SUBCLUSTER_TYPE = z.object({
  clusters: z.array(
    z.object({
      ids: z.array(z.string())
        .describe('List of memory item IDs belonging to this semantic sub-cluster'),
      theme: z.string()
        .describe('Short English label describing the core topic of this sub-cluster'),
    })
  )
}).describe('Structured sub-clustering of memory items by semantic theme');

export const PAIRWISE_RELATION_PROMPT = `You are a reasoning assistant.

Given two memory units:
- Node 1: "{node1}"
- Node 2: "{node2}"

Your task:
- Determine their relationship ONLY if it reveals NEW usable reasoning or retrieval knowledge that is NOT already explicit in either unit.
- Focus on whether combining them adds new temporal, causal, conditional, or conflict information.

Valid options:
- CAUSE: One clearly leads to the other.
- CONDITION: One happens only if the other condition holds.
- RELATE_TO: They are semantically related by shared people, time, place, or event, but neither causes the other.
- CONFLICT: They logically contradict each other.
- NONE: No clear useful connection.

Example:
- Node 1: "The marketing campaign ended in June."
- Node 2: "Product sales dropped in July."
Answer: CAUSE

Another Example:
- Node 1: "The conference was postponed to August due to the venue being unavailable."
- Node 2: "The venue was booked for a wedding in August."
Answer: CONFLICT

`;

export const PAIRWISE_RELATION_TYPR = z.object({
  relationship: z.enum(["CAUSE", "CONDITION", "RELATE_TO", "CONFLICT", "NONE"])
})

export const INFER_FACT_PROMPT = `You are an inference expert.

Source Memory: "{source}"
Target Memory: "{target}"

They are connected by a {relation_type} relation.
Derive ONE new factual statement that clearly combines them in a way that is NOT a trivial restatement.

Requirements:
- Include relevant time, place, people, and event details if available.
- If the inference is a logical guess, explicitly use phrases like "It can be inferred that...".

Example:
Source: "John missed the team meeting on Monday."
Target: "Important project deadlines were discussed in that meeting."
Relation: CAUSE
Inference: "It can be inferred that John may not know the new project deadlines."

If there is NO new useful fact that combines them, reply exactly: "None"
`
export const INFER_FACT_TYPE = z.object({
  inference: z.string()
});

export const AGGREGATE_PROMPT = `You are a concept summarization assistant.

Below is a list of memory items:
{joined}

Your task:
- Identify if they can be meaningfully grouped under a new, higher-level concept that clarifies their shared time, place, people, or event context.
- Do NOT aggregate if the overlap is trivial or obvious from each unit alone.
- If the summary involves any plausible interpretation, explicitly note it (e.g., "This suggests...").

Example:
Input Memories:
- "Mary organized the 2023 sustainability summit in Berlin."
- "Mary presented a keynote on renewable energy at the same summit."

Good Aggregate:
{{
  "key": "Mary's Sustainability Summit Role",
  "value": "Mary organized and spoke at the 2023 sustainability summit in Berlin, highlighting renewable energy initiatives.",
  "tags": ["Mary", "summit", "Berlin", "2023"],
  "background": "Combined from multiple memories about Mary's activities at the summit."
}}

If you find NO useful higher-level concept, reply exactly: "None".
`

export const AGGREGATE_TYPE = z.object({
  key: z.string().describe("The high-level concept or title summarizing the aggregated memories."),
  value: z.string().describe("A concise summary that unifies the individual memory items under a meaningful context."),
  tags: z.array(z.string()).describe("Relevant tags extracted from the content to help with future retrieval or categorization."),
  background: z.string().describe("A short explanation noting how the summary was formed and its relation to the input memories."),
})

export const CONFLICT_DETECTOR_PROMPT = `You are given two plaintext statements. Determine if these two statements are factually contradictory. Respond with only "yes" if they contradict each other, or "no" if they do not contradict each other. Do not provide any explanation or additional text.
Statement 1: {statement_1}
Statement 2: {statement_2}
`

export const CONFLICT_RESOLVER_PROMPT = `You are given two facts that conflict with each other. You are also given some contextual metadata of them. Your task is to analyze the two facts in light of the contextual metadata and try to reconcile them into a single, consistent, non-conflicting fact.
- Don't output any explanation or additional text, just the final reconciled fact, try to be objective and remain independent of the context, don't use pronouns.
- Try to judge facts by using its time, confidence etc.
- Try to retain as much information as possible from the perspective of time.
If the conflict cannot be resolved, output <answer>No</answer>. Otherwise, output the fused, consistent fact in enclosed with <answer></answer> tags.

Output Example 1:
<answer>No</answer>

Output Example 2:
<answer> ... </answer>

Now reconcile the following two facts:
Statement 1: {statement_1}
Metadata 1: {metadata_1}
Statement 2: {statement_2}
Metadata 2: {metadata_2}
`

export const REDUNDANCY_MERGE_PROMPT = `You are given two pieces of text joined by the marker \`⟵MERGED⟶\`.
Please carefully read both sides of the merged text.
Your task is to summarize and consolidate all the factual details from both sides into a single, coherent text, without omitting any information.
You must include every distinct detail mentioned in either text.
Do not provide any explanation or analysis — only return the merged summary.
Don't use pronouns or subjective language, just the facts as they are presented.

{merged_text}
`
