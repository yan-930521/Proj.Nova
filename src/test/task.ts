/**
 * 非正式(測試用)
 */

import { createInterface } from 'readline';

import { HumanMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';

import { MemoryReader } from '../application/memory/MemoryReader';
import { GraphNodeMetadata, MemoryTree, NODES_PATH } from '../application/memory/tree/MemoryTree';
import { Nova } from '../application/Nova';
import { Persona, PersonaResponse } from '../application/persona/Persona';
import { LATS } from '../application/task/lats/LATS';
import { SubAgent } from '../application/task/SubAgent';
import { LongtermTask, Task, TaskResponse } from '../application/task/Task';
import { Message } from '../application/user/UserIO';
import { ComponentContainer } from '../ComponentContainer';
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
    let user = await LevelDBUserRepository.getInstance().findById("823885929830940682");
    if (!user) {
        user = new User("823885929830940682", "櫻2", {})
        let res = await LevelDBUserRepository.getInstance().create(user);
        if (!res || !user) return;
    }

    const session = await ComponentContainer.getNova().SessionContext.ensureSession(user.id);

    const TestShorttermTask = () => {
        const task = new Task({
            user,
            userInput: "下載指定的圖片並保存至本地。圖片鏈接為 https://images-ext-1.discordapp.net/external/Et_tPcDKyzu6NyAo5Ii1_DRzceSrYdeOz6lLkwKs00Y/https/cdn.discordapp.com/icons/855817825822179329/11e7988d1bf46a6f955f3f425e8c8ba0.png?format=webp&quality=lossless&width=200&height=200",
            description: "下載指定的圖片並保存至本地。圖片鏈接為 https://images-ext-1.discordapp.net/external/Et_tPcDKyzu6NyAo5Ii1_DRzceSrYdeOz6lLkwKs00Y/https/cdn.discordapp.com/icons/855817825822179329/11e7988d1bf46a6f955f3f425e8c8ba0.png?format=webp&quality=lossless&width=200&height=200"
            // `Subtask [1]\n  - Objective      : Explain how WebSocket establishes a connection.\n  - Expected Output: Detailed explanation of the WebSocket handshake process.`
        });

        ComponentContainer.getNova().emit("taskCreate", task, session);
    }

    const TestLongtermTask = () => {
        console.log("Testing Longterm Task");
        const task = new LongtermTask({
            user,
            "name": "temperature_monitor_task",
            "monitor_config": {
                "resources": [
                    {
                        "name": "temperature",
                        "check_interval": "10s",
                        "threshold": 35,
                        "on_above_threshold": "send_alert",
                        "min": 10,
                        "max": 30,
                        "on_violation": "log_violation"
                    }
                ]
            },
            "subtasks": [
                {
                    "name": "collect_temperature",
                    "description": "每5秒收集一次溫度資料",
                    "type": "jscode",
                    "schedule": {
                        "type": "interval",
                        "trigger": "5s"
                    },
                    "js_code": "(() => {\n  const temperature = Math.floor(Math.random() * 50);\n log('Temperature: ' + temperature);\nreturn temperature;\n})()",
                    "resource": "temperature"
                },
                {
                    "name": "send_alert",
                    "description": "當溫度高於閾值時發送警報 (此處示範用 console.log)",
                    "type": "jscode",
                    "schedule": {
                        "type": "threshold-triggered",
                        "trigger": "temperature"
                    },
                    "js_code": "(() => {\n  log('警告：溫度過高！');\n})()"
                },
                {
                    "name": "log_violation",
                    "description": "當溫度超出允許範圍時記錄違規事件",
                    "type": "jscode",
                    "schedule": {
                        "type": "threshold-triggered",
                        "trigger": "temperature"
                    },
                    "js_code": "(() => {\n  log('警告：溫度異常！');\n})()"
                }
            ]
        });

        ComponentContainer.getNova().TaskOrchestrator.longtermTaskManager.registerMonitor(task);
        ComponentContainer.getNova().TaskOrchestrator.longtermTaskManager.registerSubtasks(task)
    }

    TestLongtermTask()

    // ComponentContainer.getNova().TaskOrchestrator.subAgent.handleTask(task);
});