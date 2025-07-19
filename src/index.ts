/**
 * 非正式(測試用)
 */

import {
    Client, EmbedBuilder, Events, GatewayIntentBits, Message, SlashCommandBuilder, TextChannel
} from 'discord.js';

import { AssistantResponse } from './application/assistant/Assistant';
import { MemoryCube } from './application/memory/MemoryCube';
import { MemoryReader } from './application/memory/MemoryReader';
import { MemoryTree } from './application/memory/tree/MemoryTree';
import { Nova } from './application/Nova';
import { Session } from './application/SessionContext';
import { LATS } from './application/task/lats/LATS';
import { ComponentContainer } from './ComponentContainer';
import { TaskResponse } from './domain/entities/Task';
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

    const cube = new MemoryCube();
    await cube.loadCube(ComponentContainer.getConfig().defaultCharacter);

    const cmdParser = async (msg: Message, session: Session, input: string) => {
        const cmd = input.toLowerCase();
        const reply = (description: string) => {
            const costTime = Date.now() - msg.createdTimestamp;
            const embed = new EmbedBuilder({
                description,
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
        if (cmd == "getmem") {
            let str = "Memory Tree:\n" + cube.toString(session);
            reply("```" + str + "```");
            return true;
        } else if (cmd == "getdmem") {
            let str = "Memory Tree:\n" + cube.toDetailString(session);
            reply("```" + str + "```");
            return true;
        } else if (cmd.startsWith("search")) {
            session = await ComponentContainer.getNova().SessionContext.get(session.user.id) as Session;
            if (!session) return;
            let querys = input.split(" ");
            querys.shift();
            let result = await cube.search(querys.join(" "), 3, session);
            let str = "Search Tree:\n" + result;
            reply("```" + str + "```");
            return true;
        } else if (cmd.startsWith("load")) {
            let querys = input.split(" ");
            querys.shift();
            await cube.loadCube(querys.join(" "));
            reply("load graph success");
            return true;
        } else if (cmd == "optimize") {
            reply("Start Structure optimize.");
            await cube.treeOptimizeLoop();
            reply("Structure optimization finished.");
            return true;
        } else if (cmd.startsWith("save")) {
            let querys = input.split(" ");
            querys.shift();
            await cube.saveCube(querys.join(" "));
            reply("save graph success");
            return true;
        } else if (cmd == "stop_task") {
            let list = await LevelDBTaskRepository.getInstance().findByMetadata({
                user: session.user,
            });
            list.map((t) => {
                ComponentContainer.getNova().logger.debug("Force stop task: " + t.id);
                t.forceExit.abort();
            });
            return true;
        }
        return false;
    }

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
        if (msg.author.id == (client as Client<true>).user.id) return;


        if (msg.channelId != "1105093381085995058") {
            if (!msg.mentions.users.find((user) => user.id == (client as Client<true>).user.id)) {
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
                const session = await ComponentContainer.getNova().SessionContext.ensureSession(user.id)
                session.context.memories = cube.getMemory(session).split("\n");

                let result = await cmdParser(msg, session, ct);
                if (result) return;
                const reply = async (response: { task?: TaskResponse, assistant?: AssistantResponse }) => {
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
                            description: `${response.assistant.response}${response.assistant.reasoning == "" ? "" : "\n\n\`" + response.assistant.reasoning + "\`"}`,
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

                        const memories = await ComponentContainer.getMemoryReader().extractFromMessages(session);
                        await cube.memoryTree?.add(memories);
                    }
                }

                ComponentContainer.getNova().UserIO.recieve({
                    content: ct,
                    type: 'user',
                    user,
                    timestamp: msg.createdTimestamp,
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
    //             true;
    //         });
    //     }

    //     true;
    // });
});