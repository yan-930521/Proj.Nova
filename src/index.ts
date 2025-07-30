/**
 * 非正式(測試用)
 */

import {
    Client, EmbedBuilder, Events, GatewayIntentBits, Message, SlashCommandBuilder, TextChannel
} from 'discord.js';

import { MessageContentComplex } from '@langchain/core/messages';

import { MemoryCube } from './application/memory/MemoryCube';
import { MemoryReader } from './application/memory/MemoryReader';
import { Nova } from './application/Nova';
import { PersonaResponse } from './application/persona/Persona';
import { Session } from './application/SessionContext';
import { LATS } from './application/task/lats/LATS';
import { TaskResponse } from './application/task/Task';
import { ComponentContainer } from './ComponentContainer';
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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildIntegrations
    ]
});

const getChannel = (client: Client, id: string): TextChannel | undefined => {
    return client.channels.cache.get(id) as TextChannel;
}

const cleanMsg = (content: string) => {
    return content.replace(/<a?:.+?:\d{18}>|\p{Extended_Pictographic}/gu, "").replace(/<@(\d+)>/, "").trim();
}

const MAX_EMBED_DESC_LENGTH = 2000;

const splitText = (text: string, maxLength: number): string[] => {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.slice(i, i + maxLength));
    }
    return chunks;
};


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

    const cube = ComponentContainer.getMemoryCube();

    const cmdParser = async (msg: Message, session: Session, input: string) => {
        const cmd = input.toLowerCase();
        const reply = (description: string) => {
            const costTime = Date.now() - msg.createdTimestamp;

            const messageChunks = splitText(description, MAX_EMBED_DESC_LENGTH);
            messageChunks.forEach(async (chunk, index) => {
                await msg.reply({
                    embeds: [
                        new EmbedBuilder({
                            description: chunk,
                            color: 14194326,
                            footer: {
                                text: `cost: ${costTime / 1000} s`
                            },
                            timestamp: index === messageChunks.length - 1 ? new Date() : undefined
                        })
                    ],
                    allowedMentions: { repliedUser: false }
                });
            });
        }
        if (cmd == "getmem") {
            let str = "Memory Tree:\n" + cube.toString(null, session);
            reply("```" + str + "```");
            return true;
        } else if (cmd == "getdmem") {
            let str = "Memory Tree:\n" + cube.toDetailString(null, session);
            reply("```" + str + "```");
            return true;
        } else if (cmd.startsWith("search")) {
            session = ComponentContainer.getNova().SessionContext.get(session.user.id) as Session;
            if (!session) return;
            let querys = input.split(" ");
            querys.shift();
            let result = await cube.search(querys.join(" "), 3, session);
            cube.toDetailString(result, session);
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
                id: userId
            },
            embeds
        } = msg;

        let user = await LevelDBUserRepository.getInstance().findById(userId);
        if (!user) {
            user = User.fromDiscordUser(msg.author)
            let res = await LevelDBUserRepository.getInstance().create(user);
            if (!res || !user) return;
        }

        // let ct = cleanMsg(content); //.split(" ").join("，");

        let ct = content; //.split(" ").join("，");

        // read msg from self like ai
        if (ct == "" && embeds.length > 0 && embeds[0].description !== null) {
            ct = embeds[0].description;
        }

        if (ct != "" || msg.attachments.size > 0) {
            try {
                const session = await ComponentContainer.getNova().SessionContext.ensureSession(user.id);

                let result = await cmdParser(msg, session, ct);
                if (result) return;

                const reply = async (response: { task?: TaskResponse, persona?: PersonaResponse }) => {
                    const costTime = Date.now() - msg.createdTimestamp;

                    if (response.task) {
                        await msg.reply({
                            content: response.task.instruction,
                            embeds: [
                                new EmbedBuilder({
                                    title: response.task.sender,
                                    description: response.task.message,
                                    color: 14194326,
                                    footer: {
                                        text: `cost: ${costTime / 1000} s`
                                    },
                                    timestamp: new Date()
                                })
                            ],
                            allowedMentions: { repliedUser: false }
                        });
                    }

                    if (response.persona) {
                        const channel = getChannel(client, msg.channelId);
                        if (channel) channel.sendTyping();

                        const fullText = `${response.persona.response}${response.persona.reasoning === "" ? "" : "\n\n`" + response.persona.reasoning + "`"}`;

                        await msg.reply({
                            embeds: [
                                new EmbedBuilder({
                                    description: fullText,
                                    color: 14194326,
                                    footer: {
                                        text: `cost: ${costTime / 1000} s`
                                    },
                                    timestamp: new Date()
                                })
                            ],
                            allowedMentions: { repliedUser: false }
                        });

                        setImmediate(async () => {
                            const memories = await ComponentContainer.getMemoryReader().extractFromMessages(session);
                            await cube.memoryTree?.add(memories);
                        });
                    }
                };

                ComponentContainer.getNova().UserIO.recieve({
                    content: ct,
                    images: Array.from(msg.attachments.values()).map((f) => f.url),
                    type: 'user',
                    user,
                    timestamp: msg.createdTimestamp,
                    reply
                });

                const channel = getChannel(client, msg.channelId);
                if (channel) channel.sendTyping();

            } catch (error) {
                console.error('執行任務過程中出錯:', error);
            }
        }
    });
});