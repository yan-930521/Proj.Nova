/**
 * 非正式(測試用)
 */

import { createInterface } from 'readline';

import { AssistantResponse } from '../application/assistant/Assistant';
import { MemorySystemLogger } from '../application/memory/base/Memory';
import { MemoryCube } from '../application/memory/MemoryCube';
import { MemoryReader } from '../application/memory/MemoryReader';
import { MemoryTree } from '../application/memory/tree/MemoryTree';
import { Nova } from '../application/Nova';
import { Session } from '../application/SessionContext';
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
    new MemoryReader(),
    new MemoryCube()
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

    const cube = ComponentContainer.getMemoryCube();

    let user = await LevelDBUserRepository.getInstance().findById("823885929830940682");
    if (!user) {
        user = new User("823885929830940682", "櫻2", {})
        let res = await LevelDBUserRepository.getInstance().create(user);
        if (!res || !user) return;
    }

    const session = await ComponentContainer.getNova().SessionContext.ensureSession(user.id);

    const loop = () => {
        rl.question('', async (input) => {
            const cmd = input.toLowerCase();
            if (cmd == "exit") {
                return;
            } else if (cmd == "history") {
                MemorySystemLogger.debug(session.context.messages.concat(session.context.inputMessages).map((m) => m.content).join("\n"))
                return loop();
            } else if (cmd == "getmem") {
                cube.toString(null, session);
                return loop();
            } else if (cmd == "getdmem") {
                cube.toDetailString(null, session);
                return loop();
            } else if (cmd.startsWith("search")) {
                let querys = input.split(" ");
                querys.shift();
                let result = await cube.search(querys.join(" "), 3, session);
                
                cube.toDetailString(result, session);
                return loop();
            } else if (cmd == "optimize") {
                await cube.treeOptimizeLoop();
                return loop();
            } else if (cmd.startsWith("load")) {
                let querys = input.split(" ");
                querys.shift();
                await cube.loadCube()
                return loop();
            } else if (cmd.startsWith("save")) {
                let querys = input.split(" ");
                querys.shift();
                await cube.saveCube(querys.join(" "))
                return loop();
            } else if (cmd == "recreate") {
                MemorySystemLogger.debug("Recreate Vector Database Start");
                await cube.recreateVectorDatabase();
                MemorySystemLogger.debug("Recreate Vector Database Success");
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
                images: [],
                type: 'user',
                user,
                timestamp: Date.now(),
                async reply({ assistant, task }) {
                    const memories = await ComponentContainer.getMemoryReader().extractFromMessages(session);
                    await cube.memoryTree?.add(memories);
                }
            }

            ComponentContainer.getNova().UserIO.recieve(message);

            loop();
        });
    }

    loop();
});