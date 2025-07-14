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
