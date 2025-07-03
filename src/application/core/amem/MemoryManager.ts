import { z } from 'zod';

import {
    BaseMessage, HumanMessage, mergeMessageRuns, SystemMessage
} from '@langchain/core/messages';
import { ChatPromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts';
import { Runnable, RunnableConfig } from '@langchain/core/runnables';
import {
    Annotation, MemorySaver, messagesStateReducer, Send, START, StateGraph
} from '@langchain/langgraph';

import { JSONOutputToolsParser } from '../';
import { ComponentContainer } from '../../../ComponentContainer';
import { LevelDBUserRepository } from '../../../frameworks/levelDB/LevelDBUserRepository';
import {
    MEMORY_PATH, PATCH_PATH, PAYLOAD_KEY, TIMESTAMP_KEY, Vectra
} from '../../../frameworks/vectra/vectra';
import { BaseSuperVisor, BaseSuperVisorCallOptions } from '../../../libs/base/BaseSupervisor';
import { ANALYZE_PROMPT, ANALYZE_TYPE, EVOLUTION_PROMPT, EVOLUTION_TYPE } from '../prompts/amem';
import { DEFAULT_MEMORY_CONFIG, MemoryNote, MemoryNoteSchema, UserMemoryTool } from './Memory';

export const MemoryManagerState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
    functionName: Annotation<string>,
    id: Annotation<string>
})

export class MemoryManager extends BaseSuperVisor {
    AgentState = MemoryManagerState;

    chains: {
        shouldEvolution?: Runnable<any, z.infer<typeof EVOLUTION_TYPE>>
        analyzeContent?: Runnable
    } = {};

    memories: Record<string, MemoryNote> = {};

    evo_cnt: number = 0;
    evo_threshold: number = 100;

    constructor(options?: BaseSuperVisorCallOptions) {
        super({
            name: "MemoryManager",
            ...options
        });
    }

    initLogic(): Promise<void> {
        return new Promise(async (res, rej) => {
            try {
                this._llm = ComponentContainer.getLLMManager().getLLM();

                this.chains.shouldEvolution = ChatPromptTemplate.fromMessages([
                    SystemMessagePromptTemplate.fromTemplate(EVOLUTION_PROMPT)
                ]).pipe(
                    this.llm.withStructuredOutput(EVOLUTION_TYPE)
                );

                this.chains.analyzeContent = ChatPromptTemplate.fromMessages([
                    SystemMessagePromptTemplate.fromTemplate(ANALYZE_PROMPT)
                ]).pipe(
                    this.llm.withStructuredOutput(ANALYZE_TYPE)
                );

                // loadmemory

                const result = await Vectra.getInstance().listItems();

                result.forEach((noteData) => {
                    let n = MemoryNote.fromJson(noteData.metadata);
                    this.memories[n.id] = n;
                    // console.log(n)
                    this.memories[n.id].dbId = noteData.id;
                    this.memories[n.id].vector = noteData.vector;
                });

                this.createGraph();

                res();
            } catch (err) {
                rej(this.handleError(err));
            }
        });
    }

    node(state: {}) {
        throw new Error('Method not implemented.');
    }

    /**
     * Merge message runs and add instructions before and after to stay on task.
     */
    prepareMessages(
        messages: BaseMessage[],
        systemPrompt: string,
    ): BaseMessage[] {
        const sys: SystemMessage = new SystemMessage({
            content: `${systemPrompt}\n\n<memory-system>Reflect on following interaction. Use the provided tools to retain any necessary memories about the user. Use parallel/multi-tool calling to extract the appropriate number of memories if multiple are required.</memory-system>\n`,
        });

        const msg: HumanMessage = new HumanMessage({
            content: "## End of conversation\n\n<memory-system>Reflect on the interaction above. What memories ought to be retained or updated?</memory-system>",
        });

        return mergeMessageRuns([sys, ...messages, msg]);
    }

    scatterSchemas(state: typeof MemoryManagerState.State, config: RunnableConfig) {
        const sends: Send[] = [];
        for (const memoryConfig of DEFAULT_MEMORY_CONFIG) {
            let target: string;
            switch (memoryConfig.updateMode) {
                case "patch":
                    target = "handlePatchMemory";
                    break;
                case "insert":
                    target = "handleInsertionMemory";
                    break;
                default:
                    throw this.handleError(`Unknown update mode: ${memoryConfig.updateMode}`);
            }
            sends.push(
                new Send(target, { ...state, functionName: memoryConfig.tool.name }),
            );
        }
        return sends;
    }

    async handlePatchMemory(state: typeof MemoryManagerState.State, config: RunnableConfig) {
        const memoryConfig = DEFAULT_MEMORY_CONFIG.find((m) => m.tool.name == state.functionName);
        const existing = await LevelDBUserRepository.getInstance().findById(state.id);

        if (!memoryConfig) {
            throw this.handleError("unknown memory config");
        }

        if (!existing) {
            throw this.handleError("unknown patch id: " + state.id);
        }


        const systemPrompt = memoryConfig.systemPrompt + `\n\nExisting item: ${JSON.stringify(existing?.extraData, null, 2)}`;

        const messages = this.prepareMessages(state.messages, systemPrompt)

        const result = await this.llm.bindTools([memoryConfig.tool], {
            tool_choice: memoryConfig.tool.name
        }).pipe(JSONOutputToolsParser).invoke(messages);

        const extracted = result[0].args ?? {};

        existing.extraData = extracted;

        await LevelDBUserRepository.getInstance().update(existing);
    }

    async handleInsertionMemory(state: typeof MemoryManagerState.State, config: RunnableConfig) {
        const memoryConfig = DEFAULT_MEMORY_CONFIG.find((m) => m.tool.name == state.functionName);

        const serialized = state.messages.map((m => m.content));

        const {
            memoryContent
        } = await this.findRelatedMemories(state.id, serialized.join("\n"), 5);

        if (!memoryConfig) {
            throw this.handleError("unknown memory config");
        }

        const systemPrompt = memoryConfig.systemPrompt + `\n\nExisting items: \n${memoryContent}`;

        const messages = this.prepareMessages(state.messages, systemPrompt)

        const result = await this.llm.bindTools([memoryConfig.tool], {
            tool_choice: memoryConfig.tool.name
        }).pipe(JSONOutputToolsParser).invoke(messages);

        await Promise.all(result.map(({
            args: notedata
        }: {
            args: Partial<z.infer<typeof MemoryNoteSchema>>
        }) => {
            return this.addNote(MemoryNote.fromJson({
                userId: state.id,
                type: notedata.type,
                content: notedata.content,
                keywords: notedata.keywords,
                context: notedata.context,
                category: notedata.category,
                tags: notedata.tags,
                sentiment: notedata.sentiment,
            }));
        }));
    }

    createGraph() {
        const workflow = new StateGraph(MemoryManagerState);

        workflow
            .addNode("handlePatchMemory", this.handlePatchMemory.bind(this))
            .addNode("handleInsertionMemory", this.handleInsertionMemory.bind(this))
            .addConditionalEdges(START, this.scatterSchemas.bind(this), [
                "handlePatchMemory",
                "handleInsertionMemory",
            ]);

        this.graph = workflow.compile();
    }

    async consolidateMemories() {
        this.logger.debug("consolidate memories");
        for (let i in this.memories) {
            const memoryNote = this.memories[i];
            const path = MEMORY_PATH.replace('{memory_id}', memoryNote.id);
            const document = {
                id: memoryNote.dbId,
                vector: memoryNote.vector,
                metadata: Object.assign({
                    [PAYLOAD_KEY]: memoryNote.content,
                    [PATCH_PATH]: path,
                    [TIMESTAMP_KEY]: memoryNote.timestamp,
                }, memoryNote)
            }
            await Vectra.getInstance().upsertItem(document);
        }
    }

    /**
     * 新增一則記憶 note
     */
    async addNote(data: MemoryNote) {
        let notetmp = MemoryNote.fromJson(data);

        let {
            should_evolve,
            note,
            error
        } = await this.processMemory(notetmp);

        if (error) return null;

        this.memories[note.id] = note;

        let metadata = note.toJson();

        const embeding = ComponentContainer.getLLMManager().getEmbedingModel();
        const vector = await embeding.embedQuery(note.content);

        const path = MEMORY_PATH.replace('{memory_id}', note.id);

        const document = {
            id: path,
            vector: vector,
            metadata: Object.assign({
                [PAYLOAD_KEY]: note.content,
                [PATCH_PATH]: path,
                [TIMESTAMP_KEY]: note.timestamp,
            }, metadata)
        }

        this.memories[note.id].dbId = path;
        this.memories[note.id].vector = vector;

        await Vectra.getInstance().upsertItem(document);

        if (should_evolve) {
            this.evo_cnt += 1;
            if (this.evo_cnt % this.evo_threshold == 0) {
                await this.consolidateMemories();
            }
        }
        return note.id;
    }

    /**
     * 檢索相關記憶 note
     */
    async findRelatedMemories(userId: string, query: string, k: number = 5): Promise<{
        list: {
            index: string,
            memoryNoteId: string
        }[],
        memoryContent: string
    }> {
        const embeding = ComponentContainer.getLLMManager().getEmbedingModel();
        const vector = await embeding.embedQuery(query)

        const result = await Vectra.getInstance().queryItems<MemoryNote>(vector, k, {
            // @ts-ignore
            "userId": { "$eq": userId }
        });

        let list = [];
        let memoryContent = "";

        for (let i = 0; i < result.length; i++) {
            let {
                item: {
                    metadata: memoryNote,
                    id
                }
            } = result[i];

            list.push({
                index: id,
                memoryNoteId: memoryNote.id
            });

            memoryContent += `id: ${memoryNote.id}\ntimestamp: ${memoryNote.timestamp}\ncontent: ${memoryNote.content}\ncontext: ${memoryNote.context}\nkeywords: ${memoryNote.keywords.join(", ")}\ntags: ${memoryNote.tags.join(", ")}\n`;

            this.memories[`${memoryNote.id}`].touch();
        }

        return {
            list,
            memoryContent
        }
    }

    /**
     * return raw memory
     */
    async searchMemory(userId: string, query: string, k: number = 1, d: number = 1): Promise<string> {
        const embeding = ComponentContainer.getLLMManager().getEmbedingModel();
        const vector = await embeding.embedQuery(query)

        const results = await Vectra.getInstance().queryItems<MemoryNote>(vector, k, {
            // @ts-ignore
            "userId": { "$eq": userId }
        });

        const r_search = (idList: string[], deep: number = 1, visited: string[] = []) => {
            if (deep <= 0) return "";

            let m = "";
            for (let id of idList) {
                let n = this.memories[id];
                if (!n || visited.includes(n.id)) continue;
                visited.push(n.id);
                n.touch();
                m += `content: ${n.content}\ncontext: ${n.context}\nkeywords: ${n.keywords.join(", ")}\ntags: ${n.tags.join(", ")}\ntimestamp: ${n.timestamp}\n\n`;
                m += r_search(this.memories[id].relatedMemories, deep - 1, visited);
            }

            return m;
        }
        let memoryContent = r_search(results.map(({ item: { metadata } }) => metadata.id), d);

        return memoryContent;
    }

    /**
     * 處理記憶 note 並決定是否演化
     */
    async processMemory(note: MemoryNote): Promise<{ should_evolve: boolean; note: MemoryNote; error: boolean }> {
        // get nearest neighbors
        const {
            list,
            memoryContent
        } = await this.findRelatedMemories(note.userId, note.content, 5);

        if (list.length == 0) {
            return {
                should_evolve: false,
                note,
                error: false
            };
        }

        try {
            let result = await this.chains.shouldEvolution?.invoke({
                content: note.content,
                context: note.context,
                keywords: note.keywords,
                nearest_neighbors_memories: memoryContent,
                neighbor_number: list.length
            });

            if (result?.is_too_similar) {
                this.logger.debug("too similar, ignore the memory");
                return {
                    should_evolve: false,
                    note,
                    error: true
                }
            }

            if (result?.should_evolve) {
                result.actions.map((act) => {
                    if (act == "strengthen") {
                        note.relatedMemories = note.relatedMemories.concat(result.suggested_connections);
                        note.tags = result.tags_to_update;
                    } else if (act == "update_neighbor") {
                        for (let i = 0; i < list.length; i++) {
                            let notetmp = this.memories[list[i].memoryNoteId];

                            if (
                                !notetmp ||
                                i >= result.new_tags_neighborhood.length ||
                                i >= result.new_context_neighborhood.length
                            ) continue;

                            let tags = result.new_tags_neighborhood[i];
                            let context = result.new_context_neighborhood[i];

                            notetmp.tags = tags;
                            notetmp.context = context;
                        }
                    }
                })
            }

            return {
                should_evolve: result?.should_evolve || false,
                note,
                error: false
            }
        } catch (err) {
            let error: string;
            if (err instanceof Error) {
                error = err.message;
            } else {
                error = err as string;
            }
            this.logger.warn("記憶演化出現錯誤: " + error);

            return {
                should_evolve: false,
                note,
                error: true
            }
        }
    }

    /**
     * 合併兩則記憶，參考 A-mem: 合併內容、標籤、重要性、關聯、來源
     */
    mergeNotes(noteA: MemoryNote, noteB: MemoryNote): MemoryNote {
        // 合併內容（可用換行或特殊分隔符）
        const mergedContent = `${noteA.content}\n${noteB.content}`;
        // 合併標籤、關鍵字、關聯記憶
        const mergedTags = Array.from(new Set([...noteA.tags, ...noteB.tags]));
        const mergedKeywords = Array.from(new Set([...noteA.keywords, ...noteB.keywords]));
        const mergedRelated = Array.from(new Set([...noteA.relatedMemories, ...noteB.relatedMemories, noteB.id]));
        // 重要性取最大值或平均
        const mergedImportance = Math.max(noteA.importance, noteB.importance);
        // 合併 metadata 並記錄來源
        const mergedMetadata = {
            ...noteA.metadata,
            ...noteB.metadata,
            merged_from: [noteA.id, noteB.id, ...(noteA.metadata.merged_from || []), ...(noteB.metadata.merged_from || [])]
        };
        // 合併演化歷史
        const mergedHistory = [...noteA.evolutionHistory, ...noteB.evolutionHistory];

        const mergedNote = MemoryNote.fromJson({
            id: noteA.id, // 保留主 note 的 id
            userId: noteA.userId,
            type: noteA.type,
            content: mergedContent,
            keywords: mergedKeywords,
            context: noteA.context, // 以主 note 為主
            sentiment: noteA.sentiment,
            category: noteA.category,
            tags: mergedTags,
            importance: mergedImportance,
            evolutionHistory: mergedHistory,
            timestamp: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            relatedMemories: mergedRelated,
            metadata: mergedMetadata
        })
        mergedNote.recordEvolution?.();
        return mergedNote;
    }

    /**
     * 衰退記憶（降低重要性）
     */
    decayNotes() {
        for (const id in this.memories) {
            const note = this.memories[id];
            // 若超過7天未存取，重要性遞減
            const last = new Date(note.lastAccessed);
            if ((Date.now() - last.getTime()) > 7 * 24 * 60 * 60 * 1000) {
                note.importance = Math.max(0, note.importance - 0.1);
            }
        }
    }

    /**
     * 刷新記憶（提升近期常用記憶的重要性）
     */
    refreshNotes() {
        for (const id in this.memories) {
            const note = this.memories[id];
            // 若24小時內存取過，重要性略增
            const last = new Date(note.lastAccessed);
            if ((Date.now() - last.getTime()) < 24 * 60 * 60 * 1000) {
                note.importance = Math.min(1, note.importance + 0.05);
            }
        }
    }

    /**
     * 記憶 note 的合併/演化，可參考 memory_system.py 的 merge/decay/refresh 等設計
     */
    async evolveNotes() {
        const seenContents = new Map<string, string>();
        for (const id in this.memories) {
            const note = this.memories[id];
            if (seenContents.has(note.content)) {
                const otherId = seenContents.get(note.content)!;
                const merged = this.mergeNotes(note, this.memories[otherId]);
                this.memories[id] = merged;
                delete this.memories[otherId];
            } else {
                seenContents.set(note.content, id);
            }
        }
        // 衰退與刷新
        this.decayNotes();
        this.refreshNotes();
        // 釋放低重要性記憶
    }

    touchNote(n: MemoryNote) {
        n.touch();
        this.logger.debug("touch memorynote: ", n.id);
    }
}