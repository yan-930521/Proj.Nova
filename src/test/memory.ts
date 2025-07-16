/**
 * 非正式(測試用)
 */

import { createInterface } from 'readline';

import { AssistantResponse } from '../application/assistant/Assistant';
import { MemoryReader } from '../application/memory/MemoryReader';
import { MemoryTree } from '../application/memory/tree/MemoryTree';
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

    const loop = () => {
        rl.question('', async (input) => {
            const cmd = input.toLowerCase();
            if (cmd == "exit") {
                return;
            } else if (cmd == "clear") {
                ComponentContainer.getNova().logger.info("Chat history cleared.");
                return loop();
            } else if (cmd == "getmem") {
                ComponentContainer.getNova().logger.info("Memory Tree:\n" + memoryTree.nodeManager.toString());
                return loop();
            } else if (cmd == "getdmem") {
                ComponentContainer.getNova().logger.info("Memory Tree:\n" + memoryTree.nodeManager.toDetailString());
                return loop();
            } else if (cmd.startsWith("search")) {
                const session = await ComponentContainer.getNova().SessionContext.get(user.id);
                if (!session) return;
                let querys = input.split(" ");
                querys.shift();
                let result = await memoryTree.search(querys.join(" "), 3, session);
                ComponentContainer.getNova().logger.info("Search Memory Tree:\n" + result);
                return loop();
            } else if (cmd == "optimize") {
                await memoryTree.reorganizer.treeOptimize("LongTermMemory", 5, 3, 5);
                await memoryTree.reorganizer.treeOptimize("UserMemory", 5, 3, 5);
                return loop();
            } else if (cmd.startsWith("load")) {
                let querys = input.split(" ");
                querys.shift();
                await memoryTree.loadGraph(querys.join(" "))
                return loop();
            }else if (cmd.startsWith("save")) {
                let querys = input.split(" ");
                querys.shift();
                await memoryTree.saveGraph(querys.join(" "))
                return loop();
            } else if (cmd == "stop_task") {
                let list = await LevelDBTaskRepository.getInstance().findByMetadata({
                    user: user,
                });

                list.map((t) => {
                    ComponentContainer.getNova().logger.info("Force stop task: " + t.id);
                    t.forceExit.abort();
                });

                return loop();
            }

            const message: Message = {
                content: input,
                type: 'user',
                user,
                timestamp: Date.now(),
                async reply({ assistant, task }) {
                    const session = await ComponentContainer.getNova().SessionContext.get(user.id);
                    if (!session) return;
                    const memories = await ComponentContainer.getMemoryReader().extractFromMessages(session);
                    await memoryTree.add(memories);
                }
            }

            ComponentContainer.getNova().UserIO.recieve(message);

            loop();
        });
    }

    loop();
});