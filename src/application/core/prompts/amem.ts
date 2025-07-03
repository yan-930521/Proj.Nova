import { z } from 'zod';

export const EVOLUTION_PROMPT = `You are an AI memory evolution agent responsible for managing and evolving a knowledge base.
Analyze the the new memory note according to keywords and context, also with their several nearest neighbors memory.
Make decisions about its evolution.  

The new memory context:
{context}
content: {content}
keywords: {keywords}

The nearest neighbors memories:
{nearest_neighbors_memories}

Based on this information, determine:
1. Should this memory be evolved? Consider its relationships with other memories.
2. What specific actions should be taken (strengthen, update_neighbor)?
   2.1 If choose to strengthen the connection, which memory should it be connected to? Can you give the updated tags of this memory?
   2.2 If choose to update_neighbor, you can update the context and tags of these memories based on the understanding of these memories. If the context and the tags are not updated, the new context and tags should be the same as the original ones. Generate the new context and tags in the sequential order of the input neighbors.
Tags should be determined by the content of these characteristic of these memories, which can be used to retrieve them later and categorize them.
Note that the length of new_tags_neighborhood must equal the number of input neighbors, and the length of new_context_neighborhood must equal the number of input neighbors.
The number of neighbors is {neighbor_number}.`;

export const EVOLUTION_TYPE = z.object({
    is_too_similar: z.boolean().describe("Whether the new memory is too similar to its neighboring memories based on embedding similarity or content overlap"),
	should_evolve: z.boolean().describe("Whether the new memory should be evolved based on its relationship with neighboring memories"),
	actions: z.array(z.string()).describe("List of actions to perform, such as 'strengthen' or 'update_neighbor'"),
	suggested_connections: z.array(z.string()).describe("IDs or identifiers of the memories to strengthen connections with, if applicable"),
	tags_to_update: z.array(z.string()).describe("Updated tags for the new memory if it is being evolved"),
	new_context_neighborhood: z.array(z.string()).describe("Updated context for each neighboring memory, in the same order as input"),
	new_tags_neighborhood: z.array(z.array(z.string())).describe("Updated tags for each neighboring memory, in the same order as input; each element is an array of tags")
});

export const ANALYZE_PROMPT = `Analyze the following content comprehensively.

        Content:
        \`\`\`
        {content}
        \`\`\`

        Determine:
        1.  Primary content type (e.g., code, question, documentation, discussion, mixed, general).
        2.  If mixed, proportions of each type.
        3.  Confidence in classification (0.0 to 1.0).
        4.  Recommended embedding task types (storage and query). MUST be one of:
            - Storage: RETRIEVAL_DOCUMENT, SEMANTIC_SIMILARITY, CLASSIFICATION, CLUSTERING
            - Query: RETRIEVAL_QUERY, SEMANTIC_SIMILARITY, CLASSIFICATION, CLUSTERING
            Choose RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY for general text intended for search.
        5.  Whether content seems mixed.
        6.  Extract 5-10 relevant keywords.
        7.  Generate a concise one-sentence summary.
        8.  Overall sentiment (positive, negative, neutral).
        9.  Estimated importance score (0.0 to 1.0, based on likely usefulness).

        Return ONLY the analysis as a single JSON object:
        {{
            "primary_type": "string",
            "confidence": float,
            "types": {{ "type1": float, ... }},
            "recommended_task_types": {{ "storage": "string", "query": "string" }},
            "has_mixed_content": boolean,
            "keywords": ["string", ...],
            "summary": "string",
            "sentiment": "positive|negative|neutral",
            "importance": float
        }}`;

export const ANALYZE_TYPE = z.object({
	primary_type: z.string(),
	confidence: z.number(),
	types: z.record(z.string(), z.number()), // e.g. { "code": 0.7, "question": 0.3 }
	recommended_task_types: z.object({
		storage: z.enum(["RETRIEVAL_DOCUMENT", "SEMANTIC_SIMILARITY", "CLASSIFICATION", "CLUSTERING"]),
		query: z.enum(["RETRIEVAL_QUERY", "SEMANTIC_SIMILARITY", "CLASSIFICATION", "CLUSTERING"]),
	}),
	has_mixed_content: z.boolean(),
	keywords: z.array(z.string()),
	summary: z.string(),
	sentiment: z.enum(["positive", "negative", "neutral"]),
	importance: z.number()
});


export const MEMORABLE_EVENT_PROMPT = `Extract all memorable and relevant events for the user. Use parallel tool calls. If no significant events occurred in the conversation, simply respond with 'None'.`

export const MEMORY_EXTRACTOR = `${MEMORABLE_EVENT_PROMPT}
<system-time>{timestamp}</system-time>
<user-info>{user}</user-info>
<memory-system>
Reflect on the following interaction and record only meaningful, specific, or emotionally significant events about the user. 
DO NOT record generic conversation, small talk, greetings, or casual responses unless they reveal important facts or changes in the user's state.
Use the provided tools to retain any essential memory about the user. Use system time as the temporal context, and rewrite relative time expressions (e.g., "today", "tomorrow") into precise dates. 
Record memories using the same language the user used in the conversation.
If there are no such meaningful events, respond with "None".
</memory-system>`
