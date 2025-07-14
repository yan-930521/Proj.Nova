/**
 * 非正式(測試用)
 */

import {
    Client, EmbedBuilder, Events, GatewayIntentBits, Message, SlashCommandBuilder, TextChannel
} from 'discord.js';

import { AssistantResponse } from './application/assistant/Assistant';
import { Nova } from './application/Nova';
import { LATS } from './application/task/lats/LATS';
import { ComponentContainer } from './ComponentContainer';
import { Task, TaskResponse } from './domain/entities/Task';
import { User } from './domain/entities/User';
import { LevelDB } from './frameworks/levelDB/LevelDB';
import { LevelDBTaskRepository } from './frameworks/levelDB/LevelDBTaskRepository';
import { LevelDBUserRepository } from './frameworks/levelDB/LevelDBUserRepository';
import { checkVectra, Vectra } from './frameworks/vectra/vectra';
import { Config } from './services/Config';
import { ContextManager } from './services/ContextManager';
import { LLMManager } from './services/LLMManager';

process.on("unhandledRejection", (reason) => {
    console.error(reason)
});
process.on("uncaughtException", (reason) => {
    console.error(reason)
});

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
    new Nova(),
    new ContextManager(),
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

    client.login(ComponentContainer.getConfig().DISCORD_TOKEN);

    const testcmd = new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!');

    client.on(Events.InteractionCreate, interaction => {
        if (!interaction.isChatInputCommand()) return;
        interaction.reply('Pong!');
    });

    client.on(Events.MessageCreate, async msg => {
        // if(msg.guildId != "855817825822179329") return;
        if (msg.author.id == "1105165234911580241") return;

        if (msg.channelId != "1105093381085995058") {
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

        if (ct == "force stop") {
            let list = await LevelDBTaskRepository.getInstance().findByMetadata({
                user: user,
            });
    
            list.map((t) => {
                t.forceExit.abort();
            });
            return;
        }

        if (ct != "") {
            try {
                const reply = (response: { task?: TaskResponse, assistant?: AssistantResponse }) => {
                    const costTime = Date.now() - msg.createdTimestamp;
                    if (response.task) {
                        let channel = getChannel(client, msg.channelId);
                        if (channel) channel.sendTyping();

                        const embed = new EmbedBuilder({
                            title: response.task.sender,
                            description: `${response.task.message}`,
                            color: 14194326,
                            footer: {
                                text: `cost: ${costTime / 1000} s`
                            },
                            timestamp: new Date()
                        });

                        msg.reply({
                            embeds: [embed],
                            content: response.task.instruction,
                            allowedMentions: {
                                repliedUser: false
                            }
                        });
                    }
                    if (response.assistant) {
                        let channel = getChannel(client, msg.channelId);
                        if (channel) channel.sendTyping();

                        const embed = new EmbedBuilder({
                            description: `${response.assistant.response}\n\n\`${response.assistant.reasoning}\``,
                            color: 14194326,
                            footer: {
                                text: `cost: ${costTime / 1000} s`
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
                }

                ComponentContainer.getNova().UserIO.recieve({
                    content: ct,
                    type: 'user',
                    user,
                    timestamp: String(msg.createdTimestamp),
                    reply
                });
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