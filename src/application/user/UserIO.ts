import { MessageContent } from '@langchain/core/messages';

import { ComponentContainer } from '../../ComponentContainer';
import { User } from '../../domain/entities/User';
import { BaseComponent } from '../../libs/base/BaseComponent';
import { AssistantResponse } from '../assistant/Assistant';
import { Session } from '../SessionContext';
import { TaskResponse } from '../task/Task';

export type SenderType = 'user' | 'assistant'

export interface Message {
    content: string,
    images: string[],
    type: SenderType,
    user: User,
    timestamp: number
    reply: (response: {
        assistant?: AssistantResponse
        task?: TaskResponse
    }) => void
}


/**
 * 負責處理訊息接收與發送
 */
export class UserIO extends BaseComponent {
    msgList: Record<string, {
        delay: NodeJS.Timeout,
        msgs: Message[]
    }> = {};

    constructor() {
        super({
            name: "User I/O"
        });
    }

    protected async initLogic(): Promise<void> {
    }

    async handleMessageCreate(msg: Message) {
        const userId = msg.user.id;
        const session = await ComponentContainer.getNova().SessionContext.ensureSession(userId);

        const dispatch = () => {
            // 延遲3秒發送蒐集到的訊息陣列給Assistant
            return setTimeout(async () => {
                // 避免歷史衝突
                if (session.isReplying) {
                    this.msgList[userId].delay = dispatch();
                    return;
                }

                session.context.inputMessages.push(...this.msgList[userId].msgs);
                this.msgList[userId].msgs = [];
                ComponentContainer.getNova().emit("messageDispatch", session);
            }, 3000);
        }

        if (!this.msgList[userId]) {
            this.msgList[userId] = {
                delay: dispatch(),
                msgs: [msg]
            }
        }
        else {
            clearTimeout(this.msgList[userId].delay);
            this.msgList[userId].delay = dispatch();
            this.msgList[userId].msgs.push(msg);
        }
    }

    /**
     * 封裝 messageCreate
     * @param msg 
     */
    recieve(msg: Message) {
        ComponentContainer.getNova().emit("messageCreate", msg);
    }
}