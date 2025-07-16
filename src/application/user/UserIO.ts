import { ComponentContainer } from '../../ComponentContainer';
import { TaskResponse } from '../../domain/entities/Task';
import { User } from '../../domain/entities/User';
import { BaseComponent } from '../../libs/base/BaseComponent';
import { AssistantResponse } from '../assistant/Assistant';
import { Session } from '../SessionContext';

export type SenderType = 'user' | 'assistant'

export interface Message {
    content: string,
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
        let userId = msg.user.id;

        const dispatch = () => {
            // 延遲五秒發送蒐集到的訊息陣列給Assistant
            return setTimeout(async () => {
                // 不放裡面的話每次createmessage都要重新get
                let session = await ComponentContainer.getNova().SessionContext.get(userId);
                if (!session) {
                    session = await ComponentContainer.getNova().SessionContext.create(userId);
                }
                session.context.inputMessages = session.context.inputMessages.concat(msg);
                ComponentContainer.getNova().emit("messageDispatch", session);
            }, 5000);
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