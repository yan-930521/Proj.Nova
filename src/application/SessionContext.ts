import { AIMessage } from '@langchain/core/messages';

import { User } from '../domain/entities/User';
import { LevelDBUserRepository } from '../frameworks/levelDB/LevelDBUserRepository';
import { BaseComponent } from '../libs/base/BaseComponent';
import { ComponentStatus } from '../libs/enums/component/ComponentStatus';
import { getUid } from '../libs/utils/string';
import { Message } from './user/UserIO';

export interface Session {
    id: string
    user: User
    startedAt: number
    lastActiveAt: number
    goals: string[]
    isRunning: boolean
    status: SessionStatus
    context: Context
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
    return session.context.messages.filter((m) => m.type == 'user').pop()?.reply
    // .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
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

    async get(userId: string): Promise<Session | null> {
        let session = this.sessions.get(userId);
        if (session) return session;
        let user = await LevelDBUserRepository.getInstance().findById(userId);
        let now = Date.now();
        if (user) return {
            id: SessionContext.createId(),
            user,
            startedAt: now,
            lastActiveAt: now,
            status: SessionStatus.PENDING,
            isRunning: false,
            goals: [],
            context: {
                inputMessages: [],
                recentMessages: [],
                messages: [],
                memories: []
            }
        }
        return null;
    }

    async create(userId: string, session: Partial<Session> = {}): Promise<Session> {
        let existSession = this.sessions.get(userId);
        if (existSession) return existSession;
        let user = await LevelDBUserRepository.getInstance().findById(userId);
        let now = Date.now();
        return {
            id: SessionContext.createId(),
            user: user ?? (session.user as User),
            startedAt: now,
            lastActiveAt: now,
            status: SessionStatus.PENDING,
            isRunning: false,
            goals: [],
            context: {
                inputMessages: [],
                recentMessages: [],
                messages: [],
                memories: []
            }
        }
    }

    async update(authorId: string, newSession: Partial<Session>) {
        let session = await this.get(authorId);
        if (session) {
            Object.assign(session, newSession);
            session.lastActiveAt = Date.now();
            this.sessions.set(authorId, session);
        }
    }

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