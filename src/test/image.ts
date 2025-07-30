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
import { TaskResponse } from '../application/task/Task';
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

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const msg = new HumanMessage({
        content: [
            {
                type: "image_url",
                image_url: {
                    url: "https://media.discordapp.net/attachments/1105093381085995058/1396773544259752059/20250719_115303.jpg?ex=687f4e3b&is=687dfcbb&hm=eea6432cf14b4f77e14d9c95f228cb51bdb5f0b82e8a623563727cea86ee221a&=&format=webp&width=411&height=547"
                }
            }
        ]
    })

    let res = await ChatPromptTemplate.fromMessages([
        msg,
        HumanMessagePromptTemplate.fromTemplate("輸入: \n{input}")
    ]).pipe(await ComponentContainer.getLLMManager().create("test", {
        model: "gpt-4o"
    })).invoke({
        input: "描述這張圖片。"
    })

    console.log(res)

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