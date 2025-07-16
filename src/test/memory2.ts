/**
 * 非正式(測試用)
 */

import { createInterface } from 'readline';

import { AssistantResponse } from '../application/assistant/Assistant';
import { MemoryReader } from '../application/memory/MemoryReader';
import { GraphNodeMetadata, MemoryTree, NODES_PATH } from '../application/memory/tree/MemoryTree';
import { Nova } from '../application/Nova';
import { LATS } from '../application/task/lats/LATS';
import { Message } from '../application/user/UserIO';
import { ComponentContainer } from '../ComponentContainer';
import { TaskResponse } from '../domain/entities/Task';
import { User } from '../domain/entities/User';
import { LevelDB } from '../frameworks/levelDB/LevelDB';
import { LevelDBTaskRepository } from '../frameworks/levelDB/LevelDBTaskRepository';
import { LevelDBUserRepository } from '../frameworks/levelDB/LevelDBUserRepository';
import { checkVectra, Vectra } from '../frameworks/vectra/vectra';
import { Config } from '../services/Config';
import { ContextManager } from '../services/ContextManager';
import { LLMManager } from '../services/LLMManager';

process.on("unhandledRejection", (reason) => {
    console.error('執行過程中出錯:', reason);
});
process.on("uncaughtException", (reason) => {
    console.error('執行過程中出錯:', reason);
});
ComponentContainer.initialize([
    new Config(),
    new LLMManager(),
    new Nova(),
    new ContextManager(),
    new LATS(),
    new MemoryReader()
]).then(async () => {
    // 初始化DB
    LevelDB.initialize(
        ComponentContainer.getConfig().database.dir,
        ComponentContainer.getConfig().database.name
    );

    Vectra.initialize(
        ComponentContainer.getConfig().vectraDatabase.dir,
        ComponentContainer.getConfig().vectraDatabase.name
    )

    await checkVectra();

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const memoryTree = new MemoryTree();

    let user = await LevelDBUserRepository.getInstance().findById("test_admin");
    if (!user) {
        user = new User("test_admin", "admin", {})
        let res = await LevelDBUserRepository.getInstance().create(user);
        if (!res || !user) return;
    }
    const vector = await memoryTree.embedder.embedQuery("pudding");
    // const results = await Vectra.getInstance().queryItems<GraphNodeMetadata>(vector, 5, {
    //     // @ts-ignore
    //     "namespace": { "$eq": NODES_PATH },
    //     // @ts-ignore
    //     "user_id": {
    //         "$eq": user.id
    //     },
    //     "memory_type:"
    // });
    // console.log(results)

    // results.map((r) => console.log(r.item));
});