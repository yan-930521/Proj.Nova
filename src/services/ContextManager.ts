import { Session } from '../application/SessionContext';
import { LevelDBDiaryRepository } from '../frameworks/levelDB/LevelDBDiaryRepository';
import { LevelDBUserRepository } from '../frameworks/levelDB/LevelDBUserRepository';
import { BaseComponent } from '../libs/base/BaseComponent';

export class ContextManager extends BaseComponent {
    constructor() {
        super({
            name: "ContextManager"
        });
    }

    protected async initLogic(): Promise<void> {

    }

    async getContext(session: Session): Promise<string> {
        let context = this.getBaseContext();
        context += await this.getUserInfo(session.user.id);
        context += await this.getMemory(session);
        context += await this.getDiary();
        return context;
    }

    getBaseContext() {
        return [
            `現在時間: ${new Date().toLocaleString()}\n`
        ].join("");
    }

    async getUserInfo(userId: string) {
        let user = await LevelDBUserRepository.getInstance().findById(userId);
        if (user) {
            return "用戶資訊:\n" + user.toString() + "\n";
        }
        return "";
    }

    async getMemory(session: Session) {
        return session.context.memories.length > 0 ? "用戶相關記憶:\n" + session.context.memories.join("\n") : "";
    }

    async getDiary() {
        let date = new Date().toLocaleDateString();
        let diary = await LevelDBDiaryRepository.getInstance().findById(date);
        if (!diary) {
            diary = `${date}\n喚醒時間: ${new Date().toLocaleTimeString()}\n今天還沒跟{{user}}進行任何談話。`;
            let bool = await LevelDBDiaryRepository.getInstance().create(
                date,
                diary
            );
        }

        return "今天的日記: \n" + diary + "\n";
    }


}