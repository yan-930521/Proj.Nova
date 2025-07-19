import { AIMessage } from '@langchain/core/messages';

import { User } from '../domain/entities/User';
import { LevelDBUserRepository } from '../frameworks/levelDB/LevelDBUserRepository';
import { BaseComponent } from '../libs/base/BaseComponent';
import { ComponentStatus } from '../libs/enums/component/ComponentStatus';
import { getUid } from '../libs/utils/string';
import { MemorySystemLogger } from './memory/base/Memory';
import { Message } from './user/UserIO';

export class Session {
    constructor(
        public id: string,
        public user: User,
        public startedAt: number,
        public lastActiveAt: number,
        public goals: string[],
        public isRunning: boolean,
        public status: SessionStatus,
        public context: Context,
    ) {

    }
}

export interface Context {
    inputMessages: Message[];
    recentMessages: Message[];
    messages: Message[];
    memories: string[];
}

export enum SessionStatus {
    PENDING,
    IN_PROGRESS,
    DONE,
    FAILED
}

export interface SessionChange {
    from: SessionStatus;
    to: SessionStatus;
    at: string;
}

export const ValidSessionStatusTransitions: Record<SessionStatus, SessionStatus[]> = {
    [SessionStatus.PENDING]: [SessionStatus.IN_PROGRESS, SessionStatus.FAILED],
    [SessionStatus.IN_PROGRESS]: [SessionStatus.DONE, SessionStatus.FAILED],
    [SessionStatus.DONE]: [],
    [SessionStatus.FAILED]: []
}

export const getReplyfromSession = (session: Session) => {
    return session.context.messages.filter((m) => m.type == 'user').sort((a, b) => Number(a.timestamp) - Number(b.timestamp)).pop()?.reply
}

export class SessionContext extends BaseComponent {
    sessions = new Map<string, Session>();

    constructor() {
        super({
            name: "SessionContext"
        });
    }

    protected async initLogic(): Promise<void | this> {

    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    static createId(baseId: string = getUid()) {
        return "Session-" + baseId;
    }

    get(userId: string): Session | null {
        let session = this.sessions.get(userId);
        if (session) return session;
        return null;
    }

    async ensureSession(userId: string, _session: Partial<Session> = {}): Promise<Session> {
        let existSession = this.get(userId);
        if (existSession) return existSession;
        MemorySystemLogger.debug("Creating new session");
        let user = await LevelDBUserRepository.getInstance().findById(userId);
        let now = Date.now();
        const session =  new Session(SessionContext.createId(),
            user ?? (_session.user as User),
            now,
            now,
            [],
            false,
            SessionStatus.PENDING,
            {
                inputMessages: [],
                recentMessages: [],
                messages: [],
                memories: []
            }
        );

        Object.assign(session, _session);

        this.sessions.set(userId, session);

        return session;
    }

    // dont need?
    // async update(authorId: string, newSession: Partial<Session>) {
    //     let session = this.get(authorId);
    //     if (session) {
    //         Object.assign(session, newSession);
    //         session.lastActiveAt = Date.now();
    //         this.sessions.set(authorId, session);
    //     }
    // }

    /**
     * 判斷是否超時
     * @param timeoutMs
     * @returns 
     */
    async checkTimedOut(timeoutMs: number) {
        for (let sessionId of this.sessions.keys()) {
            let session = this.sessions.get(sessionId);
            const startedAt = new Date(session!.lastActiveAt).getTime();
            const now = Date.now();
            if ((now - startedAt) > timeoutMs && !session!.isRunning) {
                // timeout
                this.sessions.delete(sessionId);
            }
        }
    }
}