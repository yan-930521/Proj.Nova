import {
    Client, EmbedBuilder, GatewayIntentBits, Message, TextChannel, VoiceChannel
} from 'discord.js';
import { createInterface } from 'readline';

import { HumanMessage } from '@langchain/core/messages';

import { CoreAgent } from './application/core';
import { MemoryNote } from './application/core/amem/Memory';
import { MemoryManager } from './application/core/amem/MemoryManager';
import { LATS } from './application/core/lats/LATS';
import { TaskOrchestrator } from './application/core/TaskOrchestrator';
import { ComponentContainer } from './ComponentContainer';
import { Task, TaskType } from './domain/entities/Task';
import { User } from './domain/entities/User';
import { LevelDB } from './frameworks/levelDB/LevelDB';
import { LevelDBUserRepository } from './frameworks/levelDB/LevelDBUserRepository';
import { checkVectra, Vectra } from './frameworks/vectra/vectra';
import { Config } from './services/Config';
import { LLMManager } from './services/LLMManager';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});
const getChannel = (client: Client, id: string): TextChannel | undefined => {
    return client.channels.cache.get(id) as TextChannel;
}

const cleanMsg = (content: string) => {
    return content.replace(/<a?:.+?:\d{18}>|\p{Extended_Pictographic}/gu, "").replace(/<@(\d+)>/, "").trim();
}

ComponentContainer.initialize([
    new Config(),
    new LLMManager(),
    new LATS()
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

    const coreAgent = new CoreAgent();

    await coreAgent.init();

    client.login(ComponentContainer.getConfig().DISCORD_TOKEN);

        client.on("messageCreate", async msg => {
        // if(msg.guildId != "855817825822179329") return;
        if (msg.channel.id != "1105093381085995058" && msg.channel.id != "1184462386183290950" && msg.channel.id != "1271493582074810398") return;
        if (msg.author.id == "1105165234911580241") return;

        if (msg.channelId == "1271493582074810398") {
            if (!msg.mentions.users.find((user) => user.id == "1105165234911580241")) {
                return;
            }
        }

        const {
            content,
            author: {
                username,
                id: userId
            },
            createdTimestamp
        } = msg;

        const nickname = msg.author.globalName || username;

        let user = await LevelDBUserRepository.getInstance().findById(userId);
        if (!user) {
            user = User.fromDiscordUser(msg.author)
            let res = await LevelDBUserRepository.getInstance().create(user);
            if (!res || !user) return;
        }

        // console.log(user)

        let ct = cleanMsg(content); //.split(" ").join("，");

        if (ct != "") {
            try {
                // 創建任務
                let task = new Task({
                    author: user,
                    userInput: ct
                });
                task.on("response", ({ taskResponse , characterResponse }) => {
                    if (taskResponse) {
                        let channel = getChannel(client, msg.channelId);
                        if (channel) channel.sendTyping();

                        const embed = new EmbedBuilder({
                            title: taskResponse.sender,
                            description: `${taskResponse.message}`,
                            color: 14194326,
                            footer: {
                                text: `cost: ${(Date.now() - new Date(task.timestamp).getTime()) / 1000} s`
                            },
                            timestamp: new Date()
                        });

                        msg.reply({
                            embeds: [embed],
                            allowedMentions: {
                                repliedUser: false
                            }
                        });
                    }
                    if (characterResponse) {
                        let channel = getChannel(client, msg.channelId);
                        if (channel) channel.sendTyping();

                        const embed = new EmbedBuilder({
                            description: `${characterResponse.response}\n\n\`${characterResponse.reasoning}\``,
                            color: 14194326,
                            footer: {
                                text: `cost: ${(Date.now() - new Date(task.timestamp).getTime()) / 1000} s`
                            },
                            timestamp: new Date()
                        });

                        msg.reply({
                            embeds: [embed],
                            allowedMentions: {
                                repliedUser: false
                            }
                        });
                    }
                });
                coreAgent.processInput(task);
            } catch (error) {
                console.error('執行任務過程中出錯:', error);
            }
        }
    });

    // const lats = new LATS();

    // const agent = new TaskOrchestrator({});

    // agent.init().then(async () => {
    //     const rl = createInterface({
    //         input: process.stdin,
    //         output: process.stdout,
    //     });

    //     // const user = new User("admin", "櫻2");
    //     const user = await LevelDBUserRepository.getInstance().findById("admin");
    //     if (!user) return;

    //     const loop = () => {
    //         rl.question('> ', async (question) => {
    //             let task = new Task({
    //                 author: user,
    //                 userInput: question
    //             })
    //             task.on("response", ({ task, character }) => {
    //                 if (task) {
    //                     console.log("get task", task);
    //                 }
    //                 if (character) {
    //                     console.log("get c", character);
    //                 }
    //             });
    //             agent.processInput(task);
    //             loop();
    //         });
    //     }

    //     loop();
    // });
});